import type { ShipControlComponent, ShipInputCommand } from "@/shared/ecs/components";
import { integrateMotion } from "@/shared/game/entities/base";
import { updateShipPhysics, type ShipState } from "@/shared/game/entities/ship";

const cloneShipState = (state: Partial<ShipState>): ShipState => ({
  name: state.name ?? "unknown",
  type: state.type ?? "ship",
  id: state.id ?? "",
  x: state.x ?? 0,
  y: state.y ?? 0,
  angle: state.angle ?? 0,
  vx: state.vx ?? 0,
  vy: state.vy ?? 0,
  va: state.va ?? 0,
  thrust: state.thrust ?? false,
});

const simulateUntil = (
  shipState: ShipState,
  currentInput: Pick<ShipInputCommand, "thrust" | "angle">,
  fromTime: number,
  toTime: number
) => {
  const deltaMs = Math.max(0, toTime - fromTime);
  if (deltaMs <= 0) {
    return fromTime;
  }

  shipState.angle = currentInput.angle;

  const deltaSeconds = deltaMs / 1000;
  integrateMotion(shipState, deltaSeconds);
  updateShipPhysics(shipState, {
    thrust: currentInput.thrust,
    fire: false,
    delta: deltaSeconds,
  });

  return toTime;
};

export type ReconcileShipStateArgs = {
  latestServerState:
    | (Partial<ShipState> & { lastInputSequence?: number })
    | undefined;
  fallbackState: Pick<ShipState, "x" | "y" | "angle" | "vx" | "vy" | "va">;
  acknowledgedInput: ShipInputCommand | null;
  pendingInputs: ShipInputCommand[];
  localControl: Pick<ShipControlComponent, "thrust" | "angle">;
  snapshotSimTick: number;
  snapshotServerTime: number;
  predictedServerTime: number;
  simulationTickMs: number;
};

/**
 * Reconciles the local player ship by replaying unacknowledged inputs on top of
 * the latest authoritative snapshot.
 *
 * Important invariant: authoritative replay happens on simulation ticks, not on
 * transport-frame boundaries. This keeps prediction stable even if snapshots are
 * sent by a scheduler with jitter or skipped slots.
 */
export const reconcileShipState = ({
  latestServerState,
  fallbackState,
  acknowledgedInput,
  pendingInputs,
  localControl,
  snapshotSimTick,
  snapshotServerTime,
  predictedServerTime,
  simulationTickMs,
}: ReconcileShipStateArgs) => {
  const authoritative = cloneShipState({
    ...latestServerState,
    x: latestServerState?.x ?? fallbackState.x,
    y: latestServerState?.y ?? fallbackState.y,
    angle: latestServerState?.angle ?? fallbackState.angle,
    vx: latestServerState?.vx ?? fallbackState.vx,
    vy: latestServerState?.vy ?? fallbackState.vy,
    va: latestServerState?.va ?? fallbackState.va,
    thrust: latestServerState?.thrust ?? localControl.thrust,
  });

  const baseline =
    acknowledgedInput ??
    ({
      sequence: latestServerState?.lastInputSequence ?? -1,
      thrust: latestServerState?.thrust ?? localControl.thrust,
      angle: latestServerState?.angle ?? localControl.angle,
      fire: false,
      timestamp: snapshotServerTime,
    } satisfies ShipInputCommand);

  let currentInput: Pick<ShipInputCommand, "thrust" | "angle"> = {
    thrust: baseline.thrust,
    angle: baseline.angle,
  };
  let nextPendingIndex = 0;
  let simulatedTick = snapshotSimTick;

  const applyPendingInputsAtTickBoundary = (tickStartTime: number) => {
    while (nextPendingIndex < pendingInputs.length) {
      const pendingInput = pendingInputs[nextPendingIndex]!;
      if (pendingInput.timestamp > tickStartTime) {
        break;
      }

      currentInput = {
        thrust: pendingInput.thrust,
        angle: pendingInput.angle,
      };
      authoritative.angle = currentInput.angle;

      if (pendingInput.fire) {
        updateShipPhysics(authoritative, {
          thrust: currentInput.thrust,
          fire: true,
          delta: 0,
        });
      }

      nextPendingIndex++;
    }
  };

  const simulatedAheadMs = Math.max(0, predictedServerTime - snapshotServerTime);
  const fullTicksAhead = Math.floor(simulatedAheadMs / simulationTickMs);
  const remainingMs = simulatedAheadMs - fullTicksAhead * simulationTickMs;
  let simulatedTime = snapshotServerTime;

  for (let tickOffset = 0; tickOffset < fullTicksAhead; tickOffset++) {
    applyPendingInputsAtTickBoundary(simulatedTime);
    simulateUntil(
      authoritative,
      currentInput,
      simulatedTime,
      simulatedTime + simulationTickMs
    );
    simulatedTime += simulationTickMs;
    simulatedTick++;
  }

  applyPendingInputsAtTickBoundary(simulatedTime);

  if (remainingMs > 0) {
    simulateUntil(
      authoritative,
      {
        thrust: currentInput.thrust,
        angle: currentInput.angle,
      },
      simulatedTime,
      simulatedTime + remainingMs
    );
  }

  void simulatedTick;
  authoritative.angle = localControl.angle;

  return authoritative;
};
