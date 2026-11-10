import { expect, test } from "bun:test";
import { World } from "../../src/server/engine/world/world";
import { Ship } from "../../src/server/engine/entities/ship";
import { Bullet } from "../../src/server/engine/entities/bullet";
import { ServerNetwork } from "../../src/server/engine/server-network";
import type { ServerStateEvent } from "../../src/shared/network/events";

function harness() {
  const world = new World({ size: 10000, asteroidsPerMillionUnits: 0, piratesPerMillionUnits: 0 });
  const frames: ServerStateEvent[] = [];
  let sendResult = 1;
  const engine: any = {
    world,
    tick: 0,
    running: true,
    debug: { disableCompression: true },
    measurePerformance: (_: string, fn: () => unknown) => fn(),
    markProfiledTick() {},
    stop() {},
  };
  const network = new ServerNetwork(engine);
  engine.network = network;
  world.initialize(engine);
  const ws: any = {
    close() {},
    getBufferedAmount: () => 0,
    send(data: string) {
      const frame = JSON.parse(data);
      if (frame.type === "server:state" && sendResult !== 0) frames.push(frame);
      return sendResult;
    },
  };
  network.connectPlayer(ws);
  const player = network.players[0]!;
  const ship = new Ship({ id: player.id });
  player.ship = ship;
  ship.player = player;
  world.spawn(ship);
  const step = () => {
    engine.tick++;
    network.beginSimulationTick(engine.tick);
    world.prepareStreaming(20);
    world.update(0.05);
    world.postUpdate(0.05);
    network.markTickCommitted(engine.tick);
  };
  for (let i = 0; i < 20 && !ship.initialized; i++) step();
  expect(ship.initialized).toBe(true);
  const fire = (sequence: number, angle = 0) =>
    network.onMessage(ws, {
      type: "player:input",
      sequence,
      latency: 200,
      input: { fire: true, angle, shotId: sequence, firingCompensation: true },
    });
  const flush = () => network.flushCommittedState(engine.tick * 50);
  return {
    world,
    ship,
    player,
    network,
    frames,
    step,
    fire,
    flush,
    setSend: (n: number) => (sendResult = n),
  };
}

test("a burst keeps only its first shot, preserves its aim and still applies later input", () => {
  const h = harness();
  h.fire(0, 0);
  h.fire(0, 0);
  h.fire(1, Math.PI / 2);
  h.step();
  const shots = h.world.entities.filter((entity): entity is Bullet => entity instanceof Bullet);
  expect(shots).toHaveLength(1);
  expect(shots.map((s) => s.shotId)).toEqual([0]);
  expect(shots[0]!.vx).toBeGreaterThan(300);
  expect(shots[0]!.vy).toBeCloseTo(0);
  expect(h.ship.angle).toBeCloseTo(Math.PI / 2);
  expect(h.ship.lastInputSequence).toBe(1);
  expect(h.ship.vx).toBeCloseTo(-5);
  expect(h.ship.vy).toBeCloseTo(0);
  expect(h.ship.toJSON().energy).toBeGreaterThanOrEqual(75);
  expect(h.ship.toJSON().energy).toBeLessThan(77);
  h.flush();
  expect(h.frames.at(-1)!.shots).toHaveLength(2);
  expect(h.frames.at(-1)!.shots).toContainEqual({ shotId: 1, status: "rejected" });
  // A consumed shot cannot be replaced by another call later in the same tick.
  expect(h.ship.fire(true, 2)).toBe(false);
  h.fire(3, Math.PI / 2);
  h.step();
  expect(h.world.entities.filter((e) => e instanceof Bullet)).toHaveLength(2);
  expect(h.player.pendingShotResults).toEqual([
    expect.objectContaining({ shotId: 3, status: "accepted" }),
  ]);
  h.world.clear();
});

test("rejections and accepted shots survive dropped snapshots, including already destroyed bullets", () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.fire(i);
  h.step();
  expect(h.player.pendingShotResults.filter((s) => s.status === "accepted")).toHaveLength(1);
  expect(h.player.pendingShotResults.filter((s) => s.status === "rejected")).toHaveLength(4);
  expect(h.player.pendingShotResults).toContainEqual({ shotId: 4, status: "rejected" });
  const shot = h.world.entities.find((entity) => entity instanceof Bullet)!;
  shot.remove();
  h.setSend(0);
  h.flush();
  expect(h.player.pendingShotResults).toHaveLength(5);
  h.step();
  h.setSend(1);
  h.flush();
  expect(h.frames.at(-1)!.shots).toHaveLength(5);
  expect(h.player.pendingShotResults).toHaveLength(0);
  for (let i = 0; i < 5; i++) h.step();
  expect(h.world.entities.filter((e) => e instanceof Bullet)).toHaveLength(0);
  h.world.clear();
});

test("an invalid shot does not consume the tick, and loading cannot accumulate pending shots", () => {
  const h = harness();
  h.ship.restoreRuntimeState({ ...h.ship.captureRuntimeState(), energy: 0 });
  expect(h.ship.fire(false, 0)).toBe(false);
  h.ship.restoreRuntimeState({ ...h.ship.captureRuntimeState(), energy: 100 });
  expect(h.ship.fire(false, 1)).toBe(true);
  // Even if simulation is deferred to a later tick, keep only one pending shot.
  expect(h.ship.fire(false, 2, 1000)).toBe(false);
  expect(h.ship.toJSON().energy).toBe(75);
  h.step();
  expect(h.world.entities.filter((e) => e instanceof Bullet)).toHaveLength(1);
  h.world.clear();
});

test("own shots remain replicated beyond camera interest and expose streaming pauses", () => {
  const h = harness();
  h.fire(0);
  h.step();
  const shot = h.world.entities.find((entity): entity is Bullet => entity instanceof Bullet)!;
  expect(shot.toJSON().simulationPaused).toBe(true); // Spawned after the tick's simulation set.
  h.flush();
  h.step();
  expect(shot.toJSON().simulationPaused).toBe(false);
  shot.x = 4000;
  shot.y = 4000;
  h.world.updateSpatialIndex(shot);
  h.flush();
  const frame = h.frames.at(-1)!;
  const states = frame.state.type === "full" ? frame.state.entities : frame.state.updated;
  expect(states.some((s) => s.id === shot.id)).toBe(true);
  h.world.clear();
});
