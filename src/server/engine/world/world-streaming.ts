import { wrapCoordinate } from "@/shared/math/world-wrap";
import { Asteroid } from "../entities/asteroid";
import {
  ASTEROID_RECORD_WIDTH as WIDTH,
  createChunkManifest,
  generateChunk,
  type ChunkManifest,
} from "./chunk-generator";
import type { World } from "./world";
import { WORLD_CHUNK_SIZE } from "./world-config";

export type StreamingInterest = { x: number; y: number; radius: number };
type Resident = { asteroids: Set<Asteroid>; lastNeededTick: number };
type Job = { index: number; work: Generator<void, Asteroid[]> };

/** Session-only store. Eviction removes entity graphs, retaining packed Float64 state. */
export class WorldStreaming {
  readonly chunkSize = WORLD_CHUNK_SIZE;
  readonly retentionTicks = 200;
  #world: World;
  #seed = 0;
  #epoch = "";
  #manifest: ChunkManifest = { counts: new Uint32Array(), offsets: new Uint32Array() };
  #nextId = 0;
  #resident = new Map<number, Resident>();
  #owners = new Map<Asteroid, number>();
  #cold = new Map<number, Float64Array>();
  #incoming = new Map<number, Float64Array[]>();
  #transfers = new Set<Asteroid>();
  #wanted = new Set<number>();
  #jobs = new Map<number, Job>();
  #ready = new Map<number, Asteroid[]>();
  #generation = 0;
  #maxPumpMs = 0;
  constructor(world: World) {
    this.#world = world;
  }

  initialize(count: number, seed: number) {
    this.clear();
    this.#seed = seed;
    this.#epoch = crypto.randomUUID();
    this.#manifest = createChunkManifest(this.#world.borderRadius, this.chunkSize, count, seed);
    this.#nextId = count;
  }
  get seed() {
    return this.#seed;
  }
  indexAt(x: number, y: number) {
    const radius = this.#world.borderRadius,
      axis = Math.ceil((radius * 2) / this.chunkSize);
    return (
      Math.floor((wrapCoordinate(y, radius) + radius) / this.chunkSize) * axis +
      Math.floor((wrapCoordinate(x, radius) + radius) / this.chunkSize)
    );
  }
  indices(area: StreamingInterest) {
    const radius = this.#world.borderRadius,
      axis = Math.ceil((radius * 2) / this.chunkSize);
    const x = wrapCoordinate(area.x, radius) + radius,
      y = wrapCoordinate(area.y, radius) + radius;
    const result = new Set<number>();
    const extent = Math.min(area.radius, radius);
    for (
      let cx = Math.floor((x - extent) / this.chunkSize);
      cx <= Math.floor((x + extent) / this.chunkSize);
      cx++
    )
      for (
        let cy = Math.floor((y - extent) / this.chunkSize);
        cy <= Math.floor((y + extent) / this.chunkSize);
        cy++
      )
        result.add((((cy % axis) + axis) % axis) * axis + (((cx % axis) + axis) % axis));
    return result;
  }
  isReady(area: StreamingInterest) {
    for (const index of this.indices(area)) if (!this.#resident.has(index)) return false;
    return true;
  }
  request(areas: StreamingInterest[], tick: number) {
    const wanted = new Set<number>();
    const orderedJobs = new Map<number, Job>();
    // Required regions first; outer prefetch ring second, shared by all players/NPCs.
    for (const padding of [0, this.chunkSize])
      for (const area of areas)
        for (const index of this.indices({ ...area, radius: area.radius + padding }))
          wanted.add(index);
    this.#wanted = wanted;
    for (const index of wanted) {
      const resident = this.#resident.get(index);
      if (resident) {
        resident.lastNeededTick = tick;
        continue;
      }
      if (!this.#ready.has(index))
        orderedJobs.set(index, this.#jobs.get(index) ?? { index, work: this.#prepare(index) });
    }
    this.#jobs = orderedJobs;
    for (const index of this.#ready.keys()) if (!wanted.has(index)) this.#ready.delete(index);
  }
  *#prepare(index: number): Generator<void, Asteroid[]> {
    const data =
      this.#cold.get(index) ??
      (yield* generateChunk(
        this.#world.borderRadius,
        this.chunkSize,
        this.#seed,
        index,
        this.#manifest,
      ));
    const entities: Asteroid[] = [];
    for (let offset = 0; offset < data.length; offset += WIDTH) {
      entities.push(this.#decode(data, offset));
      yield;
    }
    return entities;
  }
  pump(budgetMs = 2) {
    const start = performance.now();
    while (performance.now() - start < budgetMs && this.#ready.size < 8) {
      const job = this.#jobs.values().next().value as Job | undefined;
      if (!job) break;
      const result = job.work.next();
      if (result.done) {
        this.#jobs.delete(job.index);
        this.#ready.set(job.index, result.value);
      }
    }
    this.#maxPumpMs = Math.max(this.#maxPumpMs, performance.now() - start);
  }
  commit(tick: number) {
    let committed = 0;
    for (const [index, entities] of this.#ready) {
      if (committed++ >= 4) break;
      this.#resident.set(index, { asteroids: new Set(), lastNeededTick: tick });
      for (const entity of entities) this.#world.spawn(entity);
      for (const row of this.#incoming.get(index) ?? []) this.#world.spawn(this.#decode(row, 0));
      this.#incoming.delete(index);
      this.#cold.delete(index);
      this.#ready.delete(index);
      this.#generation++;
    }
  }
  /** Called before World inserts a new body. Cold spawns never enter live indexes. */
  track(entity: Asteroid) {
    entity.x = wrapCoordinate(entity.x, this.#world.borderRadius);
    entity.y = wrapCoordinate(entity.y, this.#world.borderRadius);
    if (entity.streamingId === undefined) {
      entity.streamingId = this.#nextId++;
      entity.id = this.#id(entity.streamingId);
    }
    const index = this.indexAt(entity.x, entity.y),
      resident = this.#resident.get(index);
    if (!resident) {
      this.#append(index, this.#encode([entity]));
      return false;
    }
    resident.asteroids.add(entity);
    this.#owners.set(entity, index);
    return true;
  }
  moved(entity: Asteroid) {
    const previous = this.#owners.get(entity);
    if (previous === undefined) return;
    const index = this.indexAt(entity.x, entity.y);
    if (index === previous) return;
    this.#resident.get(previous)?.asteroids.delete(entity);
    this.#owners.set(entity, index);
    const resident = this.#resident.get(index);
    if (resident) resident.asteroids.add(entity);
    else this.#transfers.add(entity);
  }
  remove(entity: Asteroid) {
    const index = this.#owners.get(entity);
    if (index !== undefined) this.#resident.get(index)?.asteroids.delete(entity);
    this.#owners.delete(entity);
    this.#transfers.delete(entity);
  }
  finishTick(tick: number) {
    for (const entity of this.#transfers) {
      if (entity.removed) continue;
      const index = this.indexAt(entity.x, entity.y);
      if (this.#resident.has(index)) continue;
      this.#append(index, this.#encode([entity]));
      this.#world.detach(entity);
      this.#owners.delete(entity);
    }
    this.#transfers.clear();
    // Bound eviction work too. Empty snapshots are retained: they suppress regeneration.
    let count = 0;
    for (const [index, resident] of this.#resident) {
      if (tick - resident.lastNeededTick < this.retentionTicks || this.#wanted.has(index)) continue;
      if ([...resident.asteroids].some((a) => !this.#world.chunkActivity.isEntitySleeping(a)))
        continue;
      this.#cold.set(index, this.#encode([...resident.asteroids].filter((a) => !a.removed)));
      for (const a of resident.asteroids) {
        this.#world.detach(a);
        this.#owners.delete(a);
      }
      this.#resident.delete(index);
      if (++count >= 2) break;
    }
  }
  #append(index: number, row: Float64Array) {
    let rows = this.#incoming.get(index);
    if (!rows) this.#incoming.set(index, (rows = []));
    rows.push(row);
  }
  #id(id: number) {
    return `a-${this.#epoch}-${id}`;
  }
  #decode(data: Float64Array, o: number) {
    const key = data[o]!;
    const a = new Asteroid({
      id: this.#id(key),
      name: `asteroid-${key}`,
      x: data[o + 1],
      y: data[o + 2],
      angle: data[o + 3],
      vx: data[o + 4],
      vy: data[o + 5],
      va: data[o + 6],
      radius: data[o + 7],
      health: data[o + 8],
      maxHealth: data[o + 9],
      earnablePoints: data[o + 10],
    });
    a.streamingId = key;
    return a;
  }
  #encode(entities: Asteroid[]) {
    const data = new Float64Array(entities.length * WIDTH);
    entities.forEach((a, i) =>
      data.set(
        [
          a.streamingId!,
          a.x,
          a.y,
          a.angle,
          a.vx,
          a.vy,
          a.va,
          a.radius,
          a.health,
          a.maxHealth,
          a.earnablePoints,
        ],
        i * WIDTH,
      ),
    );
    return data;
  }
  getStats() {
    let bytes = 0,
      stored = 0;
    for (const data of this.#cold.values()) {
      bytes += data.byteLength;
      stored += data.length / WIDTH;
    }
    for (const rows of this.#incoming.values())
      for (const row of rows) {
        bytes += row.byteLength;
        stored += row.length / WIDTH;
      }
    return {
      seed: this.#seed,
      residentChunks: this.#resident.size,
      coldChunks: this.#cold.size,
      storedAsteroids: stored,
      storedBytes: bytes,
      queuedChunks: this.#jobs.size,
      readyChunks: this.#ready.size,
      committedChunks: this.#generation,
      maxPumpMs: this.#maxPumpMs,
    };
  }
  clear() {
    this.#resident.clear();
    this.#owners.clear();
    this.#cold.clear();
    this.#incoming.clear();
    this.#transfers.clear();
    this.#wanted.clear();
    this.#jobs.clear();
    this.#ready.clear();
    this.#generation = 0;
    this.#maxPumpMs = 0;
    this.#manifest = { counts: new Uint32Array(), offsets: new Uint32Array() };
    this.#seed = 0;
    this.#epoch = "";
    this.#nextId = 0;
  }
}
