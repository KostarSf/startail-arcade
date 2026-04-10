import type { System } from "@/shared/ecs";
import type { ShipInputCommand } from "@/shared/ecs/components";
import { integrateMotion } from "@/shared/game/entities/base";
import { updateShipPhysics, type ShipState } from "@/shared/game/entities/ship";

import type { ClientServices } from "../types";

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
  currentInput: ShipInputCommand,
  fromTime: number,
  toTime: number
) => {
  const deltaMs = Math.max(0, toTime - fromTime);
  if (deltaMs <= 0) {
    return fromTime;
  }
  const deltaSeconds = deltaMs / 1000;
  integrateMotion(shipState, deltaSeconds);
  updateShipPhysics(shipState, {
    thrust: currentInput.thrust,
    fire: false,
    delta: deltaSeconds,
  });
  return toTime;
};

/**
 * Replays buffered player inputs on top of the latest authoritative snapshot
 * so the local ship stays responsive while converging to server truth.
 */
export const ReconciliationSystem: System<ClientServices> = {
  id: "reconciliation-system",
  stage: "prediction",
  priority: 1,
  tick({ services }) {
    if (services.debug.disableReconciliation) {
      return;
    }

    const { player, stores, inputBuffer, network } = services;
    if (player.entityId === null) return;

    const transform = stores.transform.get(player.entityId);
    const velocity = stores.velocity.get(player.entityId);
    const networkState = stores.networkState.get(player.entityId);
    const shipControl = stores.shipControl.get(player.entityId);

    if (!transform || !velocity || !networkState || !shipControl) return;

    inputBuffer.acknowledge(shipControl.lastServerSequence);

    const latestServerState = networkState.state as
      | Partial<ShipState>
      | undefined;

    let baseline = inputBuffer.baseline;
    if (!baseline) {
      baseline = {
        sequence: shipControl.lastServerSequence,
        thrust: shipControl.thrust,
        angle: shipControl.angle,
        fire: false,
        timestamp: networkState.lastServerTime,
      };
      inputBuffer.setBaseline(baseline);
    }

    baseline.thrust = shipControl.thrust;
    baseline.angle = shipControl.angle;
    baseline.timestamp = Math.max(
      baseline.timestamp,
      networkState.lastServerTime
    );

    const authoritative = cloneShipState({
      ...latestServerState,
      x: latestServerState?.x ?? transform.x,
      y: latestServerState?.y ?? transform.y,
      angle: latestServerState?.angle ?? transform.angle,
      vx: latestServerState?.vx ?? velocity.vx,
      vy: latestServerState?.vy ?? velocity.vy,
      va: latestServerState?.va ?? velocity.va,
      thrust: latestServerState?.thrust ?? shipControl.thrust,
    });

    authoritative.angle = baseline.angle;

    let currentInput = baseline;
    let currentTime = baseline.timestamp;
    const predictedTime = network.predictedServerTime();

    for (const command of inputBuffer.pending) {
      authoritative.angle = currentInput.angle;
      currentTime = simulateUntil(
        authoritative,
        currentInput,
        currentTime,
        command.timestamp
      );
      currentInput = command;
      authoritative.angle = currentInput.angle;
      if (command.fire) {
        updateShipPhysics(authoritative, {
          thrust: currentInput.thrust,
          fire: true,
          delta: 0,
        });
      }
    }

    authoritative.angle = currentInput.angle;
    currentTime = simulateUntil(
      authoritative,
      currentInput,
      currentTime,
      predictedTime
    );

    transform.x = authoritative.x;
    transform.y = authoritative.y;
    transform.angle = authoritative.angle;

    velocity.vx = authoritative.vx;
    velocity.vy = authoritative.vy;
    velocity.va = authoritative.va;
  },
};
