import { expect, test } from "bun:test";
import { World } from "../../src/server/engine/world/world";
import { Engine } from "../../src/server/engine/engine";
import { Asteroid } from "../../src/server/engine/entities/asteroid";
import { Ship } from "../../src/server/engine/entities/ship";
import { Bullet } from "../../src/server/engine/entities/bullet";
import { PirateAI } from "../../src/server/engine/entities/ai/pirate-ai";
import {
  ASTEROID_RECORD_WIDTH,
  createChunkManifest,
  generateChunk,
} from "../../src/server/engine/world/chunk-generator";
import { wrappedDelta, wrappedDistance } from "../../src/shared/math/world-wrap";
import { Random } from "../../src/shared/math/random";
import { CollisionResolver } from "../../src/server/engine/world/collision-resolver";
import { WORLD_CONFIG, type WorldConfig } from "../../src/server/engine/world/world-config";

function harness(config?: WorldConfig) {
  // These seam/eviction scenarios use fixed coordinates in a 100k-wide world.
  const world = new World(config ?? { ...WORLD_CONFIG, size: 100000 });
  const engine: any = {
    tick: 0,
    network: { players: [], handleEntityDestroyed() {} },
    debug: {},
    measurePerformance: (_: unknown, fn: () => unknown) => fn(),
    markProfiledTick() {},
  };
  const originalRandom = Math.random,
    rng = new Random(42);
  Math.random = () => rng.next();
  try {
    world.initialize(engine);
  } finally {
    Math.random = originalRandom;
  }
  const step = () => {
    engine.tick++;
    world.prepareStreaming(20);
    world.update(0.05);
    world.postUpdate(0.05);
  };
  const load = (x: number, y: number, radius = 50) => {
    const area = { x, y, radius };
    for (let i = 0; i < 200; i++) {
      world.streaming.request([area], engine.tick);
      world.prepareStreaming(20);
      world.streaming.commit(engine.tick);
      if (
        world.streaming.isReady(area) &&
        world.streaming.getStats().queuedChunks === 0 &&
        world.streaming.getStats().readyChunks === 0
      )
        return;
    }
    throw new Error("Streaming did not finish");
  };
  const unload = () => {
    engine.tick += 250;
    world.streaming.request([], engine.tick);
    for (let i = 0; i < 100; i++) world.streaming.finishTick(engine.tick);
  };
  const player = (x: number, y: number) => {
    const ship = new Ship({ x, y, name: "test" });
    const p: any = { ship, cameraViewBounds: null, addScore() {} };
    ship.player = p;
    world.spawn(ship);
    engine.network.players.push(p);
    return ship;
  };
  return { world, engine, step, load, unload, player };
}

test("world starts with zero resident asteroids, exact logical count and 50 dormant pirates", () => {
  const h = harness();
  const stats = h.world.getActivityStats();
  expect(h.world.entities).toHaveLength(0);
  expect(stats.logicalAsteroids).toBe(500000);
  expect(stats.pirates).toEqual({ total: 50, active: 0, background: 50 });
  expect(stats.streaming.residentChunks).toBe(0);
  h.world.clear();
});

test("configured size and densities drive world bounds, chunks and both populations", () => {
  const h = harness({
    size: 10_000,
    asteroidsPerMillionUnits: 2.5,
    piratesPerMillionUnits: 0.03,
  });
  expect(h.world.borderRadius).toBe(5000);
  expect(h.world.pirates.limit).toBe(3);
  expect(h.world.getActivityStats()).toMatchObject({
    logicalAsteroids: 250,
    totalChunks: 100,
    pirates: { total: 3, active: 0, background: 3 },
  });
  h.load(0, 0, 5000);
  expect(h.world.entities.filter((e) => e instanceof Asteroid)).toHaveLength(250);
  h.world.clear();
  h.world.initialize(h.engine);
  expect(h.world.getActivityStats().logicalAsteroids).toBe(250);
  expect(h.world.pirates.getStats().total).toBe(3);
  h.world.clear();
});

test("zero densities keep both populations empty through loading and refill ticks", () => {
  const h = harness({
    ...WORLD_CONFIG,
    size: 2000,
    asteroidsPerMillionUnits: 0,
    piratesPerMillionUnits: 0,
  });
  h.load(0, 0, 1000);
  for (let i = 0; i < 400; i++) h.step();
  expect(h.world.entities).toHaveLength(0);
  expect(h.world.getActivityStats().logicalAsteroids).toBe(0);
  expect(h.world.pirates.getStats().total).toBe(0);
  h.world.clear();
});

test("independent chunk generation is deterministic, order-independent, and totals exactly N", () => {
  const manifest = createChunkManifest(5000, 1000, 5000, 42);
  expect([...manifest.counts].reduce((a, b) => a + b, 0)).toBe(5000);
  const generate = (index: number) => {
    const gen = generateChunk(5000, 1000, 42, index, manifest);
    while (true) {
      const result = gen.next();
      if (result.done) return result.value;
    }
  };
  const first = generate(3);
  generate(4);
  generate(95);
  expect(generate(3)).toEqual(first);
  expect(new Set([...first].filter((_, i) => i % ASTEROID_RECORD_WIDTH === 0)).size).toBe(
    first.length / ASTEROID_RECORD_WIDTH,
  );
});

test("compact eviction restores IDs, motion, health and rewards without resurrecting deleted bodies", () => {
  const h = harness();
  h.load(500, 500);
  const [a, b] = h.world.entities.filter((e): e is Asteroid => e instanceof Asteroid);
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  a!.health = 7;
  a!.vx = 123.5;
  a!.va = -0.8;
  a!.earnablePoints = 31;
  const expected = a!.toJSON(),
    id = a!.id;
  b!.remove();
  h.world.streaming.remove(b!);
  h.world.detach(b!);
  const removedId = b!.id,
    count = h.world.entities.length;
  h.unload();
  expect(h.world.entities).toHaveLength(0);
  expect(h.world.streaming.getStats().storedBytes).toBeGreaterThan(0);
  h.load(500, 500);
  expect(h.world.find(id)?.toJSON()).toEqual(expected);
  expect((h.world.find(id) as Asteroid).earnablePoints).toBe(31);
  expect(h.world.find(removedId)).toBeUndefined();
  expect(h.world.entities).toHaveLength(count);
  h.world.clear();
});

test("migration into an ungenerated chunk survives both source and destination reloads exactly once", () => {
  const h = harness();
  h.load(500, 500);
  const a = h.world.entities.find((e): e is Asteroid => e instanceof Asteroid)!;
  const old = { x: a.x, y: a.y },
    id = a.id;
  a.x = 20500;
  a.y = 20500;
  h.world.updateSpatialIndex(a);
  h.world.streaming.finishTick(h.engine.tick);
  expect(h.world.find(id)).toBeUndefined();
  h.unload();
  h.load(old.x, old.y);
  expect(h.world.find(id)).toBeUndefined();
  h.unload();
  h.load(20500, 20500);
  expect(h.world.find(id)?.x).toBe(20500);
  expect(h.world.entities.filter((e) => e.id === id)).toHaveLength(1);
  h.unload();
  h.load(20500, 20500);
  expect(h.world.entities.filter((e) => e.id === id)).toHaveLength(1);
  h.world.clear();
});

test("pending generation is discarded on reset", () => {
  const h = harness();
  h.world.streaming.request([{ x: 0, y: 0, radius: 1900 }], 1);
  h.world.prepareStreaming(0.1);
  expect(h.world.streaming.getStats().queuedChunks).toBeGreaterThan(0);
  h.world.clear();
  h.world.prepareStreaming(10);
  h.world.streaming.commit(1);
  expect(h.world.entities).toHaveLength(0);
  expect(h.world.streaming.getStats()).toMatchObject({
    queuedChunks: 0,
    readyChunks: 0,
    residentChunks: 0,
    storedBytes: 0,
  });
});

test("a bullet waits for a cold corridor and resumes when its chunks are ready", () => {
  const h = harness();
  const shot = new Bullet({ x: 12000, y: 12000, vx: 1000 });
  h.world.spawn(shot);
  h.engine.tick++;
  h.world.update(0.05);
  h.world.postUpdate(0.05);
  expect(shot.initialized).toBeFalse();
  expect(shot.x).toBe(12000);
  expect(h.world.streaming.getStats().queuedChunks).toBeGreaterThan(0);
  for (let i = 0; i < 100 && !shot.initialized; i++) h.step();
  expect(shot.initialized).toBeTrue();
  expect(shot.x).not.toBe(12000);
  h.world.clear();
});

test("a second nearby player retains a pirate after the first leaves", () => {
  const h = harness();
  const pirateState = h.world.pirates.getSnapshots()[0]!;
  const first = h.player(pirateState.x + 200, pirateState.y);
  const second = h.player(pirateState.x + 300, pirateState.y);
  h.world.pirates.update();
  first.remove();
  h.engine.tick += 300;
  h.world.pirates.update();
  expect(h.world.find(pirateState.id)).toBeInstanceOf(Ship);
  second.remove();
  h.engine.tick += 300;
  h.world.pirates.update();
  expect(h.world.find(pirateState.id)).toBeUndefined();
  h.world.clear();
});

test("pirates wake near any player, preserve stats across sleep, and do not fill the world when far away", () => {
  const h = harness();
  const original = h.world.pirates.getSnapshots()[0]!;
  const player = h.player(original.x + 200, original.y);
  for (let i = 0; i < 30; i++) h.step();
  const pirate = h.world.find(original.id) as Ship;
  expect(pirate).toBeInstanceOf(Ship);
  expect(h.world.pirates.getStats().active).toBeLessThan(50);
  pirate.health = pirate.maxHealth;
  pirate.earnablePoints = 37;
  // Remove the target by disconnecting this player, then allow chase/cooldown to expire.
  player.remove();
  h.engine.network.players = [];
  for (let i = 0; i < 400; i++) h.step();
  expect(h.world.find(pirate.id)).toBeUndefined();
  expect(h.world.pirates.getStats().total).toBe(50);
  const saved = h.world.pirates.getSnapshots().find((p) => p.id === pirate.id)!;
  const newPlayer = h.player(saved.x + 400, saved.y);
  h.world.pirates.update();
  const restored = h.world.find(pirate.id) as Ship;
  expect(restored).toBeInstanceOf(Ship);
  expect(restored.level).toBe(original.level);
  // Ships can take collision damage while active; use saved values at the freeze boundary.
  expect(restored.maxHealth).toBe(saved.maxHealth);
  expect(restored.health).toBe(saved.health);
  expect(restored.earnablePoints).toBe(saved.earnablePoints);
  expect(restored.toJSON().energy).toBe(saved.energy);
  expect(newPlayer.removed).toBeFalse();
  h.world.clear();
});

test("AI retains pursuit across both world seams and aims along the short path", () => {
  const h = harness();
  const target = h.player(-49900, -49900);
  target.initialize(h.world);
  const pirate = new Ship({ x: 49900, y: 49900 });
  const ai = new PirateAI(5);
  pirate.ai = ai;
  h.world.spawn(pirate);
  pirate.initialize(h.world);
  ai.ensureInitialized(pirate, h.world);
  const bullet = new Bullet({ ownerId: target.id });
  bullet.initialize(h.world);
  ai.onShipDamage(h.world, 1, bullet);
  for (let tick = 1; tick <= 100; tick++) {
    h.engine.tick = tick;
    ai.tick(pirate, h.world, 0.05);
  }
  expect(ai.pursuitTargetId).toBe(target.id);
  expect(ai.captureState().targetAngle).toBeCloseTo(Math.PI / 4, 3);
  expect(h.world.distance(pirate, target)).toBeCloseTo(Math.hypot(200, 200));
  pirate.x = -49950;
  pirate.y = -49950;
  h.world.updateSpatialIndex(pirate);
  ai.tick(pirate, h.world, 0.05);
  expect(ai.pursuitTargetId).toBe(target.id);
  h.world.clear();
});

test("wrapped spatial queries find the same entity across the seam without duplicates", () => {
  const h = harness();
  const ship = h.player(-49990, -49990);
  ship.initialize(h.world);
  const result = h.world
    .query({ x: 49990, y: 49990 } as any, 50)
    .precise()
    .array();
  expect(result.filter((e) => e.id === ship.id)).toHaveLength(1);
  expect(wrappedDelta(49900, -49900, 50000)).toBe(200);
  expect(wrappedDistance({ x: 49900, y: 0 }, { x: -49900, y: 0 }, 50000)).toBe(200);
  h.world.clear();
});

test("wrapping preserves travel beyond the edge instead of sticking to it", () => {
  const h = harness();
  const a = new Asteroid({ x: -49999, y: 49999, vx: -100, vy: 100 });
  a.update(h.world, 0.05);
  expect(a.x).toBe(49996);
  expect(a.y).toBe(-49996);
  a.update(h.world, 0.05);
  expect(a.x).toBe(49991);
  expect(a.y).toBe(-49991);
  h.world.clear();
});

for (const seam of [false, true]) {
  test(`swept bullets hit across ${seam ? "the world seam" : "ordinary space"} without hitting their owner`, () => {
    const h = harness();
    const start = seam ? 49990 : 0;
    const owner = h.player(start, 0);
    owner.initialize(h.world);
    const target = new Ship({ x: seam ? -49970 : 40, y: 0, health: 10000, maxHealth: 10000 });
    const unrelated = new Ship({ x: seam ? 0 : -1000, y: 0 });
    for (const ship of [target, unrelated]) {
      h.world.spawn(ship);
      ship.initialize(h.world);
    }
    const shot = new Bullet({ x: start, y: 0, vx: 1000, ownerId: owner.id, damage: 10 });
    h.world.spawn(shot);
    shot.initialize(h.world);
    shot.preUpdate(h.world, 0.05);
    shot.update(h.world, 0.05);
    h.world.updateSpatialIndex(shot);
    h.world.forEachCollisionEntity = (fn) => fn(shot);
    new CollisionResolver().update(h.world);
    expect(shot.removed).toBeTrue();
    expect(target.health).toBeLessThan(10000);
    expect(owner.health).toBe(100);
    expect(unrelated.health).toBe(100);
    expect(Math.abs(shot.x)).toBeLessThanOrEqual(50000);
    h.world.clear();
  });
}

test("a slow bullet still detects a larger collider at the side of its path", () => {
  const h = harness();
  const target = new Ship({ x: 0.5, y: 14 });
  h.world.spawn(target);
  target.initialize(h.world);
  const shot = new Bullet({ x: 0, y: 0, vx: 20 });
  h.world.spawn(shot);
  shot.initialize(h.world);
  shot.preUpdate(h.world, 0.05);
  shot.update(h.world, 0.05);
  h.world.updateSpatialIndex(shot);
  h.world.forEachCollisionEntity = (fn) => fn(shot);
  new CollisionResolver().update(h.world);
  expect(shot.removed).toBeTrue();
  expect(target.health).toBeLessThan(100);
  h.world.clear();
});

test("repeated boundary travel keeps resident objects bounded and never refills on eviction", () => {
  const h = harness();
  const player = h.player(49000, 49000);
  const count = h.world.getActivityStats().logicalAsteroids;
  for (let leg = 0; leg < 5; leg++) {
    player.x = leg % 2 ? -49000 : 49000;
    player.y = leg % 2 ? -49000 : 49000;
    h.world.updateSpatialIndex(player);
    for (let i = 0; i < 30; i++) h.step();
    expect(h.world.streaming.isReady({ x: player.x, y: player.y, radius: 100 })).toBeTrue();
  }
  expect(h.world.entities.length).toBeLessThan(15000);
  expect(h.world.getActivityStats().logicalAsteroids).toBeLessThanOrEqual(count);
  h.world.clear();
});

test("last disconnect resets everything immediately; reconnect cannot revive the old loop", async () => {
  const engine = new Engine();
  const socket = () =>
    ({
      send() {
        return 1;
      },
      getBufferedAmount() {
        return 0;
      },
      close() {},
    }) as any;
  const a = socket(),
    b = socket();
  engine.network.connectPlayer(a);
  engine.network.connectPlayer(b);
  const seed = engine.world.streaming.seed;
  engine.network.disconnectPlayer(a);
  expect(engine.running).toBeTrue();
  engine.network.disconnectPlayer(b);
  expect(engine.running).toBeFalse();
  expect(engine.tick).toBe(0);
  expect(engine.world.pirates.getStats().total).toBe(0);
  expect(engine.world.getActivityStats().logicalAsteroids).toBe(0);
  expect(engine.world.streaming.getStats().storedBytes).toBe(0);
  const c = socket();
  engine.network.connectPlayer(c);
  expect(engine.world.streaming.seed).not.toBe(seed);
  await Bun.sleep(170);
  expect(engine.tick).toBeLessThanOrEqual(4);
  engine.network.disconnectPlayer(c);
  expect(engine.running).toBeFalse();
});
