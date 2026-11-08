import { expect, test } from "bun:test";
import { ReconciliationSystem } from "../../src/client/game/systems/reconciliation-system";

test("local prediction uses newest authoritative snapshot rather than delayed render state", () => {
  const transform = { x: 0, y: 0, angle: 0 },
    velocity = { vx: 0, vy: 0, va: 0 };
  let acknowledged = -1;
  const latest = {
    id: "player",
    name: "player",
    type: "ship",
    x: 100,
    y: 50,
    angle: 0,
    vx: 0,
    vy: 0,
    va: 0,
    thrust: false,
    lastInputSequence: 9,
  };
  const services: any = {
    debug: { disableReconciliation: false },
    player: { id: "player", entityId: 1 },
    stores: {
      transform: { get: () => transform },
      velocity: { get: () => velocity },
      networkState: {
        get: () => ({ state: { ...latest, x: 0 }, lastServerTime: 350, lastSimTick: 7 }),
      },
      shipControl: { get: () => ({ thrust: false, angle: 0, lastServerSequence: 4 }) },
    },
    snapshotBuffer: {
      getLatest: () => ({ simTick: 10, serverTime: 500, entities: new Map([["player", latest]]) }),
    },
    inputBuffer: {
      baseline: null,
      pending: [],
      acknowledge: (sequence: number) => {
        acknowledged = sequence;
      },
      setBaseline() {},
    },
    network: { predictedServerTime: () => 500, simulationTickMs: 50, streamHealth: "normal" },
  };
  ReconciliationSystem.tick({ services } as any);
  expect(acknowledged).toBe(9);
  expect(transform.x).toBe(100);
  expect(transform.y).toBe(50);
});
