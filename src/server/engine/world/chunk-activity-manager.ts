import { TPS } from "../constants";
import { Asteroid } from "../entities/asteroid";
import type { BaseEntity } from "../entities/base-entity";
import { getPlayerCameraQueryBounds } from "../server-network";
import type { World } from "./world";

export type ChunkWakeSource =
  | {
      shape: "point";
      x: number;
      y: number;
    }
  | {
      shape: "circle";
      x: number;
      y: number;
      radius: number;
    };

export type ChunkSleepBehavior = "never" | "chunk";

export type ChunkActivityStats = {
  chunkSize: number;
  chunksPerAxis: number;
  totalChunks: number;
  activeChunks: number;
  sleepingChunks: number;
  justWokeChunks: number;
  activeAsteroids: number;
  sleepingAsteroids: number;
  trackedAsteroids: number;
  wakeEntities: number;
  pendingStabilizationChunks: number;
};

type ChunkState = {
  sleeping: boolean;
  lastTouchedTick: number;
  lastWakeTick: number;
  justWoke: boolean;
  stabilizationPending: boolean;
};

export class ChunkActivityManager {
  static DEFAULT_CHUNK_SIZE = 500 * 2;
  static DEFAULT_SLEEP_DELAY_TICKS = TPS;
  static PLAYER_WAKE_CHUNK_PADDING = 1;

  #borderRadius = 0;
  #worldSize = 0;
  #chunkSize = ChunkActivityManager.DEFAULT_CHUNK_SIZE;
  #chunksPerAxis = 0;
  #totalChunks = 0;
  #sleepDelayTicks = ChunkActivityManager.DEFAULT_SLEEP_DELAY_TICKS;

  #chunkStates = new Map<number, ChunkState>();
  #awakeChunks = new Set<number>();
  #justWokeChunks = new Set<number>();

  #asteroidsByChunk = new Map<number, Set<Asteroid>>();
  #asteroidChunkIndices = new Map<Asteroid, number>();
  #activeAsteroids = new Set<Asteroid>();
  #pendingAsteroidReconciliation = new Set<Asteroid>();
  #wakeEntities = new Set<BaseEntity>();

  /**
   * Initializes chunk-space dimensions from the current world bounds.
   * Must be called before any chunk queries or tick processing.
   */
  initialize(world: World) {
    this.#borderRadius = world.borderRadius;
    this.#worldSize = world.borderRadius * 2;
    this.#chunksPerAxis = Math.max(1, Math.ceil(this.#worldSize / this.#chunkSize));
    this.#totalChunks = this.#chunksPerAxis * this.#chunksPerAxis;
  }

  /** Clears all runtime chunk state, indexes, and cached active sets. */
  clear() {
    this.#chunkStates.clear();
    this.#awakeChunks.clear();
    this.#justWokeChunks.clear();
    this.#asteroidsByChunk.clear();
    this.#asteroidChunkIndices.clear();
    this.#activeAsteroids.clear();
    this.#pendingAsteroidReconciliation.clear();
    this.#wakeEntities.clear();
  }

  /**
   * Registers a newly spawned entity in chunk activity bookkeeping.
   *
   * Wake-capable entities are tracked as wake sources.
   * Sleepable asteroids are indexed by activation chunk.
   */
  onSpawn(entity: BaseEntity) {
    if (entity.canWakeChunks()) {
      this.#wakeEntities.add(entity);
    }

    if (entity.getChunkSleepBehavior() !== "chunk") {
      return;
    }

    if (!(entity instanceof Asteroid)) {
      return;
    }

    const chunkIndex = this.getChunkIndexAt(entity.x, entity.y);
    let chunkAsteroids = this.#asteroidsByChunk.get(chunkIndex);
    if (!chunkAsteroids) {
      chunkAsteroids = new Set();
      this.#asteroidsByChunk.set(chunkIndex, chunkAsteroids);
    }

    chunkAsteroids.add(entity);
    this.#asteroidChunkIndices.set(entity, chunkIndex);
    this.#pendingAsteroidReconciliation.add(entity);
  }

  /**
   * Removes an entity from wake-source tracking and chunk indexes.
   * Call this before the entity disappears from the world permanently.
   */
  onRemove(entity: BaseEntity) {
    if (entity.canWakeChunks()) {
      this.#wakeEntities.delete(entity);
    }

    if (!(entity instanceof Asteroid)) {
      return;
    }

    const chunkIndex = this.#asteroidChunkIndices.get(entity);
    if (chunkIndex !== undefined) {
      const chunkAsteroids = this.#asteroidsByChunk.get(chunkIndex);
      chunkAsteroids?.delete(entity);
      if (chunkAsteroids && chunkAsteroids.size === 0) {
        this.#asteroidsByChunk.delete(chunkIndex);
      }
      this.#asteroidChunkIndices.delete(entity);
    }

    this.#activeAsteroids.delete(entity);
    this.#pendingAsteroidReconciliation.delete(entity);
  }

  /**
   * Updates chunk bookkeeping after an entity changed world position.
   *
   * Only sleepable entities need chunk-index maintenance for now, which means
   * asteroids in the current Phase 1 implementation.
   */
  onEntityMoved(entity: BaseEntity) {
    if (!(entity instanceof Asteroid)) {
      return;
    }

    const previousChunkIndex = this.#asteroidChunkIndices.get(entity);
    const nextChunkIndex = this.getChunkIndexAt(entity.x, entity.y);
    if (previousChunkIndex === nextChunkIndex) {
      return;
    }

    if (previousChunkIndex !== undefined) {
      const previousChunkAsteroids = this.#asteroidsByChunk.get(previousChunkIndex);
      previousChunkAsteroids?.delete(entity);
      if (previousChunkAsteroids && previousChunkAsteroids.size === 0) {
        this.#asteroidsByChunk.delete(previousChunkIndex);
      }
    }

    let nextChunkAsteroids = this.#asteroidsByChunk.get(nextChunkIndex);
    if (!nextChunkAsteroids) {
      nextChunkAsteroids = new Set();
      this.#asteroidsByChunk.set(nextChunkIndex, nextChunkAsteroids);
    }
    nextChunkAsteroids.add(entity);
    this.#asteroidChunkIndices.set(entity, nextChunkIndex);
    this.#pendingAsteroidReconciliation.add(entity);
  }

  /**
   * Builds the snapshot of active chunks and active asteroids for the current
   * tick using player camera bounds, wake-capable entities, wrap-aware chunk
   * mirroring, and the configured sleep grace period.
   */
  beginTick(world: World, delta: number) {
    const tick = world.engine.tick;
    const touchedChunks = new Set<number>();
    this.#justWokeChunks.clear();

    this.#touchPlayerViewChunks(world, touchedChunks);
    this.#touchWakeEntityChunks(world, delta, touchedChunks);

    for (const chunkIndex of touchedChunks) {
      const state = this.#getOrCreateChunkState(chunkIndex);
      state.lastTouchedTick = tick;
      if (state.sleeping) {
        state.sleeping = false;
        state.lastWakeTick = tick;
        state.justWoke = true;
        state.stabilizationPending = true;
        this.#awakeChunks.add(chunkIndex);
        this.#justWokeChunks.add(chunkIndex);
        this.#addChunkAsteroidsToActiveSet(chunkIndex);
      } else {
        state.justWoke = false;
      }
    }

    for (const chunkIndex of this.#awakeChunks) {
      if (touchedChunks.has(chunkIndex)) {
        continue;
      }

      const state = this.#getOrCreateChunkState(chunkIndex);
      state.justWoke = false;
      if (tick - state.lastTouchedTick < this.#sleepDelayTicks) {
        continue;
      }

      state.sleeping = true;
      state.stabilizationPending = false;
      this.#awakeChunks.delete(chunkIndex);
      this.#removeChunkAsteroidsFromActiveSet(chunkIndex);
    }

    if (this.#pendingAsteroidReconciliation.size > 0) {
      for (const asteroid of this.#pendingAsteroidReconciliation) {
        const chunkIndex = this.#asteroidChunkIndices.get(asteroid);
        if (chunkIndex === undefined) {
          continue;
        }

        if (this.#awakeChunks.has(chunkIndex)) {
          this.#activeAsteroids.add(asteroid);
        } else {
          this.#activeAsteroids.delete(asteroid);
        }
      }
      this.#pendingAsteroidReconciliation.clear();
    }
  }

  /**
   * Softly separates overlapping asteroids in newly awakened chunks without
   * changing their velocity or angular velocity.
   *
   * This prevents explosive collision resolution when sleeping chunks become
   * active again after asteroids drifted into overlap.
   */
  applyWakeStabilization(world: World) {
    const processedPairs = new Set<string>();

    for (const chunkIndex of this.#justWokeChunks) {
      const state = this.#chunkStates.get(chunkIndex);
      if (!state?.stabilizationPending) {
        continue;
      }

      const chunkAsteroids = this.#asteroidsByChunk.get(chunkIndex);
      if (!chunkAsteroids || chunkAsteroids.size === 0) {
        state.stabilizationPending = false;
        continue;
      }

      for (const asteroid of chunkAsteroids) {
        if (asteroid.removed) {
          continue;
        }

        for (const neighborChunkIndex of this.#getNeighborChunkIndices(chunkIndex)) {
          if (neighborChunkIndex !== chunkIndex && !this.#awakeChunks.has(neighborChunkIndex)) {
            continue;
          }

          const neighborAsteroids = this.#asteroidsByChunk.get(neighborChunkIndex);
          if (!neighborAsteroids) {
            continue;
          }

          const neighborJustWoke = this.#justWokeChunks.has(neighborChunkIndex);

          for (const other of neighborAsteroids) {
            if (asteroid === other || other.removed) {
              continue;
            }

            const pairKey = this.#getPairKey(asteroid, other);
            if (processedPairs.has(pairKey)) {
              continue;
            }
            processedPairs.add(pairKey);

            this.#separateAsteroidPair(world, asteroid, other, neighborJustWoke);
          }
        }
      }

      state.stabilizationPending = false;
    }
  }

  /** Returns the asteroid snapshot that should be simulated this tick. */
  getActiveAsteroids() {
    return this.#activeAsteroids.values();
  }

  /**
   * Returns whether an entity currently belongs to a sleeping chunk.
   *
   * Non-sleepable entities always return false.
   */
  isEntitySleeping(entity: BaseEntity) {
    if (entity.getChunkSleepBehavior() !== "chunk") {
      return false;
    }

    const chunkIndex = this.getChunkIndexAt(entity.x, entity.y);
    return !this.#awakeChunks.has(chunkIndex);
  }

  /**
   * Returns whether asteroid-vs-asteroid collision is enabled for a pair.
   *
   * Both asteroids must belong to active chunks in the current tick snapshot.
   */
  isAsteroidCollisionEnabled(a: Asteroid, b: Asteroid) {
    return !this.isEntitySleeping(a) && !this.isEntitySleeping(b);
  }

  /** Returns debug/test counters describing the current chunk activity state. */
  getStats(): ChunkActivityStats {
    return {
      chunkSize: this.#chunkSize,
      chunksPerAxis: this.#chunksPerAxis,
      totalChunks: this.#totalChunks,
      activeChunks: this.#awakeChunks.size,
      sleepingChunks: this.#totalChunks - this.#awakeChunks.size,
      justWokeChunks: this.#justWokeChunks.size,
      activeAsteroids: this.#activeAsteroids.size,
      sleepingAsteroids: this.#asteroidChunkIndices.size - this.#activeAsteroids.size,
      trackedAsteroids: this.#asteroidChunkIndices.size,
      wakeEntities: this.#wakeEntities.size,
      pendingStabilizationChunks: Array.from(this.#chunkStates.values()).filter(
        (state) => state.stabilizationPending,
      ).length,
    };
  }

  /** Converts a world position into a wrapped activation-chunk index. */
  getChunkIndexAt(x: number, y: number) {
    const chunkX = this.#getChunkCoord(x);
    const chunkY = this.#getChunkCoord(y);
    return this.#toChunkIndex(chunkX, chunkY);
  }

  #touchPlayerViewChunks(world: World, touchedChunks: Set<number>) {
    for (const player of world.engine.network.players) {
      const { queryPos, queryRadius } = getPlayerCameraQueryBounds(player);
      this.#touchCircleWithWrap(
        queryPos.x,
        queryPos.y,
        queryRadius + this.#chunkSize * ChunkActivityManager.PLAYER_WAKE_CHUNK_PADDING,
        touchedChunks,
      );
    }
  }

  #touchWakeEntityChunks(world: World, delta: number, touchedChunks: Set<number>) {
    for (const entity of this.#wakeEntities) {
      if (entity.removed) {
        continue;
      }

      const wakeSources = entity.getChunkWakeSources(world, delta);
      for (const source of wakeSources) {
        if (source.shape === "point") {
          this.#touchPointWithWrap(source.x, source.y, touchedChunks);
          continue;
        }

        this.#touchCircleWithWrap(source.x, source.y, source.radius, touchedChunks);
      }
    }
  }

  #touchPointWithWrap(x: number, y: number, touchedChunks: Set<number>) {
    for (const mirroredPoint of this.#getMirroredPoints(x, y)) {
      touchedChunks.add(this.getChunkIndexAt(mirroredPoint.x, mirroredPoint.y));
    }
  }

  #touchCircleWithWrap(x: number, y: number, radius: number, touchedChunks: Set<number>) {
    for (const mirroredPoint of this.#getMirroredPoints(x, y, radius)) {
      this.#touchCircle(mirroredPoint.x, mirroredPoint.y, radius, touchedChunks);
    }
  }

  #touchCircle(x: number, y: number, radius: number, touchedChunks: Set<number>) {
    const normalizedX = this.#normalizeWorldPosition(x);
    const normalizedY = this.#normalizeWorldPosition(y);
    const minChunkX = Math.floor((normalizedX - radius) / this.#chunkSize);
    const maxChunkX = Math.floor((normalizedX + radius) / this.#chunkSize);
    const minChunkY = Math.floor((normalizedY - radius) / this.#chunkSize);
    const maxChunkY = Math.floor((normalizedY + radius) / this.#chunkSize);

    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      const wrappedChunkX = this.#wrapChunkCoord(chunkX);
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
        const wrappedChunkY = this.#wrapChunkCoord(chunkY);
        touchedChunks.add(this.#toChunkIndex(wrappedChunkX, wrappedChunkY));
      }
    }
  }

  #getMirroredPoints(x: number, y: number, radius: number = 0) {
    const xOffsets = new Set([0]);
    const yOffsets = new Set([0]);

    if (x - radius < -this.#borderRadius) {
      xOffsets.add(this.#worldSize);
    }
    if (x + radius > this.#borderRadius) {
      xOffsets.add(-this.#worldSize);
    }
    if (y - radius < -this.#borderRadius) {
      yOffsets.add(this.#worldSize);
    }
    if (y + radius > this.#borderRadius) {
      yOffsets.add(-this.#worldSize);
    }

    const mirroredPoints: { x: number; y: number }[] = [];
    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        mirroredPoints.push({ x: x + xOffset, y: y + yOffset });
      }
    }

    return mirroredPoints;
  }

  #getNeighborChunkIndices(chunkIndex: number) {
    const chunkX = chunkIndex % this.#chunksPerAxis;
    const chunkY = Math.floor(chunkIndex / this.#chunksPerAxis);
    const neighbors: number[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      const neighborX = this.#wrapChunkCoord(chunkX + dx);
      for (let dy = -1; dy <= 1; dy++) {
        const neighborY = this.#wrapChunkCoord(chunkY + dy);
        neighbors.push(this.#toChunkIndex(neighborX, neighborY));
      }
    }

    return neighbors;
  }

  #separateAsteroidPair(world: World, asteroid: Asteroid, other: Asteroid, otherJustWoke: boolean) {
    const dx = other.x - asteroid.x;
    const dy = other.y - asteroid.y;
    const radiusSum = asteroid.radius + other.radius;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= radiusSum * radiusSum) {
      return;
    }

    const distance = Math.sqrt(distanceSquared);
    const overlap = radiusSum - distance;
    if (overlap <= 0) {
      return;
    }

    const normalX = distance > 0.0001 ? dx / distance : 1;
    const normalY = distance > 0.0001 ? dy / distance : 0;

    const asteroidJustWoke = this.#justWokeChunks.has(this.getChunkIndexAt(asteroid.x, asteroid.y));

    if (asteroidJustWoke && otherJustWoke) {
      const shift = overlap * 0.5;
      asteroid.x -= normalX * shift;
      asteroid.y -= normalY * shift;
      other.x += normalX * shift;
      other.y += normalY * shift;
      asteroid.markChanged();
      other.markChanged();
      world.updateSpatialIndex(asteroid);
      world.updateSpatialIndex(other);
      return;
    }

    if (asteroidJustWoke) {
      asteroid.x -= normalX * overlap;
      asteroid.y -= normalY * overlap;
      asteroid.markChanged();
      world.updateSpatialIndex(asteroid);
      return;
    }

    if (otherJustWoke) {
      other.x += normalX * overlap;
      other.y += normalY * overlap;
      other.markChanged();
      world.updateSpatialIndex(other);
    }
  }

  #getPairKey(a: Asteroid, b: Asteroid) {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  #addChunkAsteroidsToActiveSet(chunkIndex: number) {
    const chunkAsteroids = this.#asteroidsByChunk.get(chunkIndex);
    if (!chunkAsteroids) {
      return;
    }

    for (const asteroid of chunkAsteroids) {
      this.#activeAsteroids.add(asteroid);
    }
  }

  #removeChunkAsteroidsFromActiveSet(chunkIndex: number) {
    const chunkAsteroids = this.#asteroidsByChunk.get(chunkIndex);
    if (!chunkAsteroids) {
      return;
    }

    for (const asteroid of chunkAsteroids) {
      this.#activeAsteroids.delete(asteroid);
    }
  }

  #getOrCreateChunkState(chunkIndex: number) {
    let state = this.#chunkStates.get(chunkIndex);
    if (!state) {
      state = {
        sleeping: true,
        lastTouchedTick: -Infinity,
        lastWakeTick: -Infinity,
        justWoke: false,
        stabilizationPending: false,
      };
      this.#chunkStates.set(chunkIndex, state);
    }
    return state;
  }

  #getChunkCoord(value: number) {
    const normalized = this.#normalizeWorldPosition(value);
    return this.#wrapChunkCoord(Math.floor(normalized / this.#chunkSize));
  }

  #normalizeWorldPosition(value: number) {
    return (((value + this.#borderRadius) % this.#worldSize) + this.#worldSize) % this.#worldSize;
  }

  #wrapChunkCoord(value: number) {
    return ((value % this.#chunksPerAxis) + this.#chunksPerAxis) % this.#chunksPerAxis;
  }

  #toChunkIndex(chunkX: number, chunkY: number) {
    return chunkY * this.#chunksPerAxis + chunkX;
  }
}
