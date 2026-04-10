import { describe, expect, test } from "bun:test";

import type { ShipInputCommand } from "../../src/shared/ecs/components";
import type { GenericNetEntityState } from "../../src/shared/game/entities/base";
import { reconcileShipState } from "../../src/client/game/network/reconcile-ship-state";

function createCommand(
  overrides: Partial<ShipInputCommand>
): ShipInputCommand {
  return {
    sequence: overrides.sequence ?? 0,
    thrust: overrides.thrust ?? false,
    angle: overrides.angle ?? 0,
    fire: overrides.fire ?? false,
    timestamp: overrides.timestamp ?? 0,
  };
}

describe("reconcileShipState", () => {
  test("replays pending inputs on simulation tick boundaries", () => {
    const reconciled = reconcileShipState({
      latestServerState: {
        id: "ship-1",
        type: "ship",
        name: "pilot",
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
        thrust: false,
        lastInputSequence: 0,
      } satisfies Partial<GenericNetEntityState>,
      fallbackState: {
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
      },
      acknowledgedInput: createCommand({
        sequence: 0,
        thrust: false,
        angle: 0,
        timestamp: 1_000,
      }),
      pendingInputs: [
        createCommand({
          sequence: 1,
          thrust: true,
          angle: 0,
          timestamp: 1_200,
        }),
      ],
      localControl: {
        thrust: true,
        angle: 0,
      },
      snapshotSimTick: 22,
      snapshotServerTime: 1_100,
      predictedServerTime: 1_300,
      simulationTickMs: 50,
    });

    expect(reconciled.x).toBeCloseTo(1.35, 5);
    expect(reconciled.vx).toBeCloseTo(47.52, 5);
  });

  test("does not activate a pending input before its tick boundary", () => {
    const reconciled = reconcileShipState({
      latestServerState: {
        id: "ship-1",
        type: "ship",
        name: "pilot",
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
        thrust: false,
        lastInputSequence: 0,
      } satisfies Partial<GenericNetEntityState>,
      fallbackState: {
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
      },
      acknowledgedInput: createCommand({
        sequence: 0,
        thrust: false,
        angle: 0,
        timestamp: 1_000,
      }),
      pendingInputs: [
        createCommand({
          sequence: 1,
          thrust: true,
          angle: 0,
          timestamp: 1_140,
        }),
      ],
      localControl: {
        thrust: true,
        angle: 0,
      },
      snapshotSimTick: 22,
      snapshotServerTime: 1_100,
      predictedServerTime: 1_149,
      simulationTickMs: 50,
    });

    expect(reconciled.vx).toBe(0);
    expect(reconciled.angle).toBe(0);
  });

  test("keeps the acknowledged input active until a newer pending input reaches the next tick", () => {
    const reconciled = reconcileShipState({
      latestServerState: {
        id: "ship-1",
        type: "ship",
        name: "pilot",
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
        thrust: false,
        lastInputSequence: 0,
      } satisfies Partial<GenericNetEntityState>,
      fallbackState: {
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
      },
      acknowledgedInput: createCommand({
        sequence: 0,
        thrust: false,
        angle: 0,
        timestamp: 1_000,
      }),
      pendingInputs: [
        createCommand({
          sequence: 1,
          thrust: true,
          angle: 0,
          timestamp: 1_249,
        }),
      ],
      localControl: {
        thrust: true,
        angle: 0,
      },
      snapshotSimTick: 22,
      snapshotServerTime: 1_100,
      predictedServerTime: 1_300,
      simulationTickMs: 50,
    });

    expect(reconciled.x).toBe(0);
    expect(reconciled.vx).toBeCloseTo(27, 5);
    expect(reconciled.angle).toBe(0);
  });
});
