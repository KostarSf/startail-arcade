import type { System } from "@/shared/ecs";
import type { ShipState } from "@/shared/game/entities/ship";

import { reconcileShipState } from "../network/reconcile-ship-state";
import type { ClientServices } from "../types";

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
      | (Partial<ShipState> & { lastInputSequence?: number })
      | undefined;

    let baseline = inputBuffer.baseline;
    if (!baseline) {
      baseline = {
        sequence: shipControl.lastServerSequence,
        thrust: latestServerState?.thrust ?? shipControl.thrust,
        angle: latestServerState?.angle ?? shipControl.angle,
        fire: false,
        timestamp: networkState.lastServerTime,
      };
      inputBuffer.setBaseline(baseline);
    }

    const authoritative = reconcileShipState({
      latestServerState,
      fallbackState: {
        x: transform.x,
        y: transform.y,
        angle: transform.angle,
        vx: velocity.vx,
        vy: velocity.vy,
        va: velocity.va,
      },
      acknowledgedInput: baseline,
      pendingInputs: inputBuffer.pending,
      localControl: {
        thrust: shipControl.thrust,
        angle: shipControl.angle,
      },
      snapshotSimTick: networkState.lastSimTick,
      snapshotServerTime: networkState.lastServerTime,
      predictedServerTime: network.predictedServerTime(),
      simulationTickMs: network.simulationTickMs,
    });

    transform.x = authoritative.x;
    transform.y = authoritative.y;
    transform.angle = authoritative.angle;

    velocity.vx = authoritative.vx;
    velocity.vy = authoritative.vy;
    velocity.va = authoritative.va;
  },
};
