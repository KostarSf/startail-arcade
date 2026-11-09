import { expect, test } from "bun:test";
import { PredictedShots } from "../../src/client/game/network/predicted-shots";
import type { GenericNetEntityState } from "../../src/shared/game/entities/base";
import { createBulletSpawnState } from "../../src/shared/game/entities/ship";
import { reconcileShipState } from "../../src/client/game/network/reconcile-ship-state";

const ship: GenericNetEntityState = {
  id: "player",
  name: "player",
  type: "ship",
  x: 0,
  y: 0,
  angle: 0,
  vx: 0,
  vy: 0,
  va: 0,
  energy: 100,
  lastInputSequence: -1,
};
const snapshot = (tick: number, states: GenericNetEntityState[]) => ({
  simTick: tick,
  serverTime: tick * 50,
  entities: new Map(states.map((s) => [s.id, s])),
});
const bullet = (
  shotId: number,
  extra: Partial<GenericNetEntityState> = {},
): GenericNetEntityState => ({
  id: `server-${shotId}`,
  name: "bullet",
  type: "bullet",
  ownerId: ship.id,
  shotId,
  x: 10,
  y: 0,
  vx: 350,
  vy: 0,
  va: 0,
  angle: 0,
  life: 5,
  ...extra,
});

test("local fire cooldown follows server TPS, discards extra clicks and resets on disconnect", () => {
  const model = new PredictedShots();
  expect(model.tryFire(1000, 50)).toBe(true);
  expect(model.tryFire(1000, 50)).toBe(false);
  expect(model.tryFire(1049.9, 50)).toBe(false);
  expect(model.tryFire(1050, 50)).toBe(true);
  expect(model.tryFire(1074, 25)).toBe(false);
  expect(model.tryFire(1075, 25)).toBe(true);
  model.clear();
  expect(model.tryFire(1075, 25)).toBe(true);
});

test("server rejection removes the predicted bullet and frees its reserved energy", () => {
  const model = new PredictedShots();
  model.predict(1, ship.id, ship, false, 1000);
  model.predict(2, ship.id, ship, false, 1050);
  expect(model.availableEnergy(ship)).toBe(50);
  model.reconcile(
    snapshot(22, [ship, bullet(1)]),
    [{ shotId: 2, status: "rejected" }],
    ship.id,
    1150,
    5000,
  );
  expect(model.shots.get(1)!.removed).toBe(false);
  expect(model.shots.get(2)!.removed).toBe(true);
  expect(model.availableEnergy(ship)).toBe(75);
});

test("instant spawn uses shared motion compensation and reserves unacknowledged energy", () => {
  const model = new PredictedShots();
  const moving = { ...ship, vx: 100, vy: 40, angle: 0.7 };
  const shot = model.predict(1, ship.id, moving, true, 1000)!;
  expect(shot.state).toMatchObject(createBulletSpawnState(moving, true));
  expect(shot.confirmed).toBe(false);
  for (let i = 2; i <= 4; i++) model.predict(i, ship.id, ship, false, 1000);
  model.predict(1, ship.id, ship, false, 1000);
  expect(model.shots.size).toBe(4);
  expect(model.availableEnergy(ship)).toBe(0);
  expect(model.availableEnergy({ ...ship, energy: 50, lastInputSequence: 2 })).toBe(0);
});

test("confirmation preserves identity and compares trajectories at the same time", () => {
  const model = new PredictedShots();
  const shot = model.predict(1, ship.id, ship, false, 1000)!;
  shot.entityId = 42;
  // Server fired 50ms later; received at 1150, not at the snapshot's 1100.
  model.reconcile(
    snapshot(22, [ship, bullet(1, { x: 27.5 })]),
    [{ shotId: 1, status: "accepted", bulletId: "server-1" }],
    ship.id,
    1150,
    5000,
  );
  expect(model.shots.get(1)).toBe(shot);
  expect(shot.entityId).toBe(42);
  expect(shot.confirmed).toBe(true);
  expect(model.position(shot, 1150, 5000).x).toBeCloseTo(45);
  expect(shot.offsetX).toBeCloseTo(17.5);
  model.tick(1200, 0.08);
  expect(shot.offsetX).toBeCloseTo(17.5 / Math.E);
  expect(model.position(shot, 1200, 5000).x).toBeCloseTo(62.5);
});

test("rejection, death before first snapshot and later removal terminate predictions", () => {
  const model = new PredictedShots();
  for (let i = 1; i <= 3; i++) model.predict(i, ship.id, ship, false, 1000);
  model.reconcile(
    snapshot(22, [ship, bullet(3)]),
    [
      { shotId: 1, status: "rejected" },
      { shotId: 2, status: "accepted", bulletId: "already-dead" },
    ],
    ship.id,
    1150,
    5000,
  );
  expect(model.shots.get(1)!.removed).toBe(true);
  expect(model.shots.get(2)!.removed).toBe(true);
  expect(model.shots.get(3)!.removed).toBe(false);
  model.reconcile(snapshot(23, [ship]), [], ship.id, 1200, 5000);
  expect(model.shots.get(3)!.removed).toBe(true);
});

test("wrap correction stays short, paused chunks hold position and stale streams are bounded", () => {
  const model = new PredictedShots();
  const shot = model.predict(1, ship.id, { ...ship, x: 4980 }, false, 1000)!;
  model.reconcile(snapshot(22, [ship, bullet(1, { x: -4980 })]), [], ship.id, 1150, 5000);
  expect(Math.abs(shot.offsetX)).toBeLessThan(30);
  model.reconcile(
    snapshot(23, [ship, bullet(1, { x: -4980, simulationPaused: true })]),
    [],
    ship.id,
    1200,
    5000,
  );
  expect(model.position(shot, 5000, 5000).x).toBe(-4980);
  model.reconcile(snapshot(24, [ship, bullet(1, { x: -4980 })]), [], ship.id, 1250, 5000);
  expect(model.position(shot, 5000, 5000).x).toBeCloseTo(-4892.5);
});

test("timeout and disconnect clear speculative state; server shots survive owner death", () => {
  const model = new PredictedShots();
  const first = model.predict(1, ship.id, ship, false, 0)!;
  model.tick(3001, 0.016);
  expect(first.removed).toBe(true);
  model.reconcile(snapshot(70, [bullet(2)]), [], ship.id, 3500, 5000);
  expect(model.shots.get(2)!.removed).toBe(false);
  model.clear();
  expect(model.shots.size).toBe(0);
  expect(model.availableEnergy(ship)).toBe(100);
  model.reconcile(snapshot(1, [ship, bullet(3)]), [], ship.id, 50, 5000);
  expect(model.shots.has(3)).toBe(true);
});

test("replaying a predicted shot applies recoil once, and acknowledgement does not replay it", () => {
  const command = {
    sequence: 1,
    thrust: false,
    angle: 0,
    fire: true,
    timestamp: 1000,
    firingCompensation: true,
    predictedFire: true,
  };
  const args = {
    latestServerState: ship,
    fallbackState: ship,
    acknowledgedInput: null,
    pendingInputs: [command],
    localControl: { thrust: false, angle: 0 },
    snapshotSimTick: 20,
    snapshotServerTime: 1000,
    predictedServerTime: 1000,
    simulationTickMs: 50,
    streamHealth: "normal" as const,
    worldRadius: 5000,
  };
  const predicted = reconcileShipState(args);
  expect(predicted.vx).toBeCloseTo(-5);
  expect(ship.vx).toBe(0);
  const confirmed = reconcileShipState({
    ...args,
    latestServerState: { ...ship, vx: -5, lastInputSequence: 1 },
    acknowledgedInput: command,
    pendingInputs: [],
  });
  expect(confirmed.vx).toBeCloseTo(-5);
});
