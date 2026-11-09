import type { GenericNetEntityState } from "@/shared/game/entities/base";
import {
  createBulletSpawnState,
  SHIP_CONSTANTS,
  type ShipState,
} from "@/shared/game/entities/ship";
import { wrapCoordinate, wrappedDelta } from "@/shared/math/world-wrap";
import type { ShotResult } from "@/shared/network/events";
import type { WorldState } from "./snapshot-buffer";

export interface PredictedShot {
  shotId: number;
  state: GenericNetEntityState;
  anchorTime: number;
  createdAt: number;
  confirmed: boolean;
  removed: boolean;
  offsetX: number;
  offsetY: number;
  entityId?: number;
  indexId: string;
}

export const isOwnPredictedBullet = (
  state: GenericNetEntityState | undefined,
  ownerId: string | null,
) => state?.type === "bullet" && state.ownerId === ownerId && state.shotId !== undefined;

/** No collision or damage authority: only spawn prediction and snapshot reconciliation. */
export class PredictedShots {
  readonly shots = new Map<number, PredictedShot>();
  #reservedEnergy = new Set<number>();
  #lastSnapshotTick = -1;
  #lastFireTime = -Infinity;

  /** Use monotonic local time: server clock corrections must not alter the cooldown. */
  canFire(now: number, tickDurationMs: number) {
    return now - this.#lastFireTime >= tickDurationMs;
  }

  tryFire(now: number, tickDurationMs: number) {
    if (!this.canFire(now, tickDurationMs)) return false;
    this.#lastFireTime = now;
    return true;
  }

  availableEnergy(ship: GenericNetEntityState) {
    const ack = ship.lastInputSequence ?? -1;
    let pending = 0;
    for (const sequence of this.#reservedEnergy) if (sequence > ack) pending++;
    return Math.max(0, (ship.energy ?? 0) - pending * SHIP_CONSTANTS.shotEnergy);
  }

  predict(
    shotId: number,
    ownerId: string,
    ship: Pick<ShipState, "x" | "y" | "angle" | "vx" | "vy">,
    compensated: boolean,
    now: number,
  ) {
    if (this.shots.has(shotId)) return;
    const spawn = createBulletSpawnState(ship, compensated);
    const id = `predicted-shot:${ownerId}:${shotId}`;
    const shot: PredictedShot = {
      shotId,
      state: {
        ...spawn,
        id,
        name: id,
        type: "bullet",
        ownerId,
        shotId,
        va: 0,
        radius: 3,
        life: SHIP_CONSTANTS.bulletLife,
      },
      anchorTime: now,
      createdAt: now,
      confirmed: false,
      removed: false,
      offsetX: 0,
      offsetY: 0,
      indexId: id,
    };
    this.shots.set(shotId, shot);
    this.#reservedEnergy.add(shotId);
    return shot;
  }

  position(shot: PredictedShot, now: number, radius: number) {
    // Do not extrapolate indefinitely through a disconnected/stalled server.
    const horizon = shot.confirmed ? 250 : 1000;
    const age = shot.state.simulationPaused
      ? 0
      : Math.min(Math.max(0, now - shot.anchorTime), horizon) / 1000;
    const delta = Math.min(age, shot.state.life ?? SHIP_CONSTANTS.bulletLife);
    return {
      x: wrapCoordinate(shot.state.x + shot.state.vx * delta, radius),
      y: wrapCoordinate(shot.state.y + shot.state.vy * delta, radius),
      angle: Math.atan2(shot.state.vy, shot.state.vx),
    };
  }

  reconcile(
    snapshot: WorldState,
    results: readonly ShotResult[],
    ownerId: string,
    now: number,
    radius: number,
  ) {
    if (snapshot.simTick <= this.#lastSnapshotTick) return;
    this.#lastSnapshotTick = snapshot.simTick;
    const ship = snapshot.entities.get(ownerId);
    for (const sequence of this.#reservedEnergy) {
      if (!ship || sequence <= (ship.lastInputSequence ?? -1))
        this.#reservedEnergy.delete(sequence);
    }

    const live = new Set<number>();
    for (const state of snapshot.entities.values()) {
      if (!isOwnPredictedBullet(state, ownerId)) continue;
      const shotId = state.shotId!;
      live.add(shotId);
      let shot = this.shots.get(shotId);
      if (!shot) {
        shot = {
          shotId,
          state: { ...state },
          anchorTime: snapshot.serverTime,
          createdAt: now,
          confirmed: true,
          removed: false,
          offsetX: 0,
          offsetY: 0,
          indexId: state.id,
        };
        this.shots.set(shotId, shot);
      } else {
        const before = this.position(shot, now, radius);
        const oldX = before.x + shot.offsetX,
          oldY = before.y + shot.offsetY;
        shot.state = { ...state };
        shot.anchorTime = snapshot.serverTime;
        shot.confirmed = true;
        shot.removed = false;
        const after = this.position(shot, now, radius);
        shot.offsetX = wrappedDelta(after.x, oldX, radius);
        shot.offsetY = wrappedDelta(after.y, oldY, radius);
        if (Math.hypot(shot.offsetX, shot.offsetY) > 100) shot.offsetX = shot.offsetY = 0;
      }
    }

    for (const result of results) {
      this.#reservedEnergy.delete(result.shotId);
      const shot = this.shots.get(result.shotId);
      // Accepted but already absent: hit/expired before the first published frame.
      if (shot && (result.status === "rejected" || !live.has(result.shotId))) shot.removed = true;
    }
    for (const shot of this.shots.values()) {
      if ((shot.confirmed && !live.has(shot.shotId)) || (!ship && !shot.confirmed))
        shot.removed = true;
    }
  }

  tick(now: number, dt: number) {
    for (const shot of this.shots.values()) {
      const decay = Math.exp(-Math.max(0, dt) / 0.08);
      shot.offsetX *= decay;
      shot.offsetY *= decay;
      if (!shot.confirmed && now - shot.createdAt > 3000) {
        shot.removed = true;
        this.#reservedEnergy.delete(shot.shotId);
      }
    }
  }

  clear() {
    this.shots.clear();
    this.#reservedEnergy.clear();
    this.#lastSnapshotTick = -1;
    this.#lastFireTime = -Infinity;
  }
}
