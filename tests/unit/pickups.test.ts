import { expect, test } from "bun:test";
import { World } from "../../src/server/engine/world/world";
import { Asteroid } from "../../src/server/engine/entities/asteroid";
import { Ship } from "../../src/server/engine/entities/ship";
import { Bullet } from "../../src/server/engine/entities/bullet";
import { Pickup } from "../../src/server/engine/entities/pickup";
import { PirateAI } from "../../src/server/engine/entities/ai/pirate-ai";
import { ITEM_CONFIG } from "../../src/shared/game/items";
import {
  ASTEROID_RECORD_WIDTH as WIDTH,
  createChunkManifest,
  generateChunk,
} from "../../src/server/engine/world/chunk-generator";
import type { BaseEntity } from "../../src/server/engine/entities/base-entity";

function harness() {
  const world = new World({ size: 2000, asteroidsPerMillionUnits: 0, piratesPerMillionUnits: 0 });
  const engine: any = {
    tick: 0,
    network: { players: [], handleEntityDestroyed() {} },
    debug: {},
    measurePerformance: (_: string, fn: () => unknown) => fn(),
    markProfiledTick() {},
  };
  world.initialize(engine);
  const area = { x: 0, y: 0, radius: 1000 };
  world.streaming.request([area], 0);
  for (let i = 0; i < 10; i++) {
    world.prepareStreaming(20);
    world.streaming.commit(0);
  }
  const add = <T extends BaseEntity>(entity: T) => {
    world.spawn(entity);
    entity.initialize(world);
    return entity;
  };
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) {
      engine.tick++;
      world.prepareStreaming(20);
      world.update(0.05);
      world.postUpdate(0.05);
    }
  };
  const pickups = () =>
    world.entities.filter((e): e is Pickup => e instanceof Pickup && !e.removed);
  return { world, engine, add, step, pickups };
}

test("replacement chance affects only medium asteroids and preserves deterministic geography", () => {
  const manifest = createChunkManifest(1000, 1000, 400, 42);
  const generate = (chance: number) => {
    const gen = generateChunk(1000, 1000, 42, 0, manifest, chance);
    while (true) {
      const result = gen.next();
      if (result.done) return result.value;
    }
  };
  const none = generate(0),
    all = generate(1),
    normal = generate(0.05);
  expect(normal).toEqual(generate(0.05));
  let medium = 0;
  for (let o = 0; o < none.length; o += WIDTH) {
    expect(all.slice(o, o + 11)).toEqual(none.slice(o, o + 11));
    expect(none[o + 11]).toBe(0);
    expect(all[o + 11]).toBe(all[o + 7] === 12 ? 1 : 0);
    if (all[o + 11]) medium++;
  }
  expect(medium).toBeGreaterThan(10);
});

test("one bullet drops exactly one repair away from impact across the seam, with no experience", () => {
  const h = harness();
  const rock = h.add(new Asteroid({ x: -995, itemKind: "repair", radius: 12, maxHealth: 50 }));
  const shot = h.add(new Bullet({ x: 995, vx: 350, damage: 0.1 }));
  shot.onCollisionStart(h.world, rock);
  shot.onCollisionStart(h.world, rock);
  expect(rock.removed).toBe(true);
  expect(h.pickups()).toHaveLength(1);
  expect(h.pickups()[0]!.vx).toBeCloseTo(ITEM_CONFIG.launchSpeed);
  expect(h.pickups()[0]!.vy).toBe(0);
  expect(h.world.entities.some((e) => e.type === "exp")).toBe(false);
});

test("lethal ship impact drops repair; lethal asteroid impact and sourceless damage do not", () => {
  for (const pirate of [false, true]) {
    const h = harness();
    const ship = h.add(new Ship({ x: -20, vx: 300 }));
    if (pirate) ship.ai = new PirateAI(5);
    const rock = h.add(new Asteroid({ itemKind: "repair", radius: 12, maxHealth: 50 }));
    rock.onCollisionStart(h.world, ship);
    expect(rock.removed).toBe(true);
    expect(h.pickups()).toHaveLength(1);
    expect(h.pickups()[0]!.vx).toBeGreaterThan(0);
  }
  const h = harness();
  const rock = h.add(new Asteroid({ itemKind: "repair", maxHealth: 50, vx: 300 }));
  const other = h.add(new Asteroid({ x: 20 }));
  rock.onCollisionStart(h.world, other);
  expect(rock.removed).toBe(true);
  const second = h.add(new Asteroid({ itemKind: "repair" }));
  second.takeDamage(h.world, 1000);
  expect(h.pickups()).toHaveLength(0);
});

test("gentle ship contact does not open a repair asteroid", () => {
  const h = harness();
  const rock = h.add(new Asteroid({ itemKind: "repair", maxHealth: 50 }));
  rock.onCollisionStart(h.world, h.add(new Ship({ x: -20, vx: 100 })));
  expect(rock.health).toBe(50);
  expect(h.pickups()).toHaveLength(0);
});

test("repair heals a quarter of each recipient's maximum, caps health and can be claimed only once", () => {
  const h = harness();
  const ship = h.add(new Ship({ health: 40, maxHealth: 200 }));
  const pirate = h.add(new Ship({ health: 100, maxHealth: 400 }));
  pirate.ai = new PirateAI(5);
  const item = h.add(new Pickup());
  item.onCollisionStart(h.world, ship);
  item.onCollisionStart(h.world, pirate);
  expect(ship.health).toBe(90);
  expect(pirate.health).toBe(100);
  h.add(new Pickup()).onCollisionStart(h.world, pirate);
  expect(pirate.health).toBe(200);
  ship.health = 190;
  h.add(new Pickup()).onCollisionStart(h.world, ship);
  expect(ship.health).toBe(200);
  const untouched = h.add(new Pickup());
  untouched.onCollisionStart(h.world, ship);
  expect(untouched.removed).toBe(false);
  ship.health = 0;
  untouched.onCollisionStart(h.world, ship);
  expect(untouched.removed).toBe(false);
});

test("repair launch slows quickly, drifts, expires, and bullets push without destroying it", () => {
  const h = harness();
  const item = h.add(new Pickup({ vx: ITEM_CONFIG.launchSpeed }));
  item.update(h.world, 0.75);
  expect(item.vx).toBeLessThan(20);
  expect(item.vx).toBeGreaterThan(ITEM_CONFIG.driftSpeed);
  const shot = h.add(new Bullet({ vx: -350, damage: 999 }));
  shot.onCollisionStart(h.world, item);
  expect(shot.removed).toBe(true);
  expect(item.removed).toBe(false);
  expect(item.vx).toBeLessThan(0);
  item.update(h.world, 60);
  expect(item.removed).toBe(true);
});

test("repair reflects from asteroid across the world seam without a second separating impulse", () => {
  const h = harness();
  const rock = h.add(new Asteroid({ x: 995, radius: 12 }));
  const item = h.add(new Pickup({ x: -995, vx: -100 }));
  item.onCollisionStart(h.world, rock);
  expect(item.vx).toBeCloseTo(70);
  expect(h.world.distance(rock, item)).toBeGreaterThan(22);
  item.onCollisionStart(h.world, rock);
  expect(item.vx).toBeCloseTo(70);
});

test("real collision pipeline allows a full ship to pass and collects after injury", () => {
  const h = harness();
  const ship = h.add(new Ship({}));
  const item = h.add(new Pickup({ x: 5 }));
  h.step();
  expect(item.removed).toBe(false);
  ship.health = 50;
  h.step();
  expect(item.removed).toBe(true);
  expect(ship.health).toBe(75);
});

test("pirate opens a repair asteroid and actually flies into the dropped item", () => {
  const h = harness();
  const pirate = h.add(new Ship({ health: 30 }));
  const ai = new PirateAI(5);
  pirate.ai = ai;
  ai.ensureInitialized(pirate, h.world);
  pirate.health = pirate.maxHealth * 0.3;
  const before = pirate.health;
  const rock = h.add(new Asteroid({ x: 140, radius: 12, maxHealth: 50, itemKind: "repair" }));
  for (let i = 0; i < 600 && pirate.health === before; i++) h.step();
  expect(rock.removed).toBe(true);
  expect(pirate.health).toBeCloseTo(before + pirate.maxHealth * ITEM_CONFIG.pirateRepairFraction);
  expect(h.pickups()).toHaveLength(0);
  ai.tick(pirate, h.world, 0.05);
  expect(ai.captureState().repairTarget).toBeNull();
});

test("item contents survive cold storage and a collected asteroid never regenerates on reload", () => {
  const h = harness();
  const rock = h.add(new Asteroid({ itemKind: "repair", health: 17, maxHealth: 50 }));
  const expected = { ...rock.toJSON(), name: `asteroid-${rock.streamingId}` };
  const reload = () => {
    h.engine.tick += 250;
    h.world.streaming.request([], h.engine.tick);
    for (let i = 0; i < 4; i++) h.world.streaming.finishTick(h.engine.tick);
    expect(h.world.find(rock.id)).toBeUndefined();
    h.world.streaming.request([{ x: 0, y: 0, radius: 1000 }], h.engine.tick);
    for (let i = 0; i < 10; i++) {
      h.world.prepareStreaming(20);
      h.world.streaming.commit(h.engine.tick);
    }
  };
  reload();
  const restored = h.world.find(rock.id) as Asteroid;
  expect(restored.toJSON()).toEqual(expected);
  restored.initialize(h.world);
  restored.takeDamage(h.world, 1, h.add(new Bullet({ x: -20, vx: 350 })));
  expect(h.pickups()).toHaveLength(1);
  reload();
  expect(h.world.find(rock.id)).toBeUndefined();
  expect(h.pickups()).toHaveLength(1);
});

test("pirate prioritizes repair over an attacker below 50%, without firing at the pickup", () => {
  const h = harness();
  const pirate = h.add(new Ship({})),
    ai = new PirateAI(5);
  pirate.ai = ai;
  ai.ensureInitialized(pirate, h.world);
  pirate.health = pirate.maxHealth * 0.49;
  const attacker = h.add(new Ship({ x: 400 }));
  attacker.player = { addScore() {} } as any;
  ai.onShipDamage(h.world, 1, h.add(new Bullet({ ownerId: attacker.id })));
  const item = h.add(new Pickup({ x: 100 }));
  let shots = 0;
  pirate.fire = () => {
    shots++;
    return true;
  };
  ai.tick(pirate, h.world, 0.05);
  expect(ai.captureState().repairTarget).toBe(item.id);
  expect(ai.captureState().current).toBe(attacker.id);
  expect(shots).toBe(0);
  pirate.health = pirate.maxHealth * 0.5;
  ai.tick(pirate, h.world, 0.05);
  expect(ai.captureState().repairTarget).toBeNull();
  expect(ai.captureState().current).toBe(attacker.id);
});

test("actual ship ram collision destroys the item asteroid and emits one repair", () => {
  const h = harness();
  h.add(new Ship({ x: -30, vx: 300, maxHealth: 500 }));
  const rock = h.add(new Asteroid({ radius: 12, maxHealth: 50, itemKind: "repair" }));
  h.step();
  expect(rock.removed).toBe(true);
  expect(h.pickups()).toHaveLength(1);
});
