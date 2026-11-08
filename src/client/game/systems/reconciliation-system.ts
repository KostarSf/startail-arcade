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

    const latestSnapshot = services.snapshotBuffer.getLatest();
    const latestServerState = (player.id ? latestSnapshot?.entities.get(player.id) : undefined) as
      | (Partial<ShipState> & { lastInputSequence?: number })
      | undefined;
    if (!latestSnapshot || !latestServerState) return;
    const acknowledged = latestServerState.lastInputSequence ?? -1;
    inputBuffer.acknowledge(acknowledged);

    let baseline = inputBuffer.baseline;
    if (!baseline) {
      baseline = {
        sequence: acknowledged,
        thrust: latestServerState?.thrust ?? shipControl.thrust,
        angle: latestServerState?.angle ?? shipControl.angle,
        fire: false,
        timestamp: latestSnapshot.serverTime,
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
      snapshotSimTick: latestSnapshot.simTick,
      snapshotServerTime: latestSnapshot.serverTime,
      predictedServerTime: network.predictedServerTime(),
      simulationTickMs: network.simulationTickMs,
      streamHealth: network.streamHealth,
    });

    transform.x = authoritative.x;
    transform.y = authoritative.y;
    transform.angle = authoritative.angle;

    velocity.vx = authoritative.vx;
    velocity.vy = authoritative.vy;
    velocity.va = authoritative.va;
  },
};
