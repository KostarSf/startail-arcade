import {
  normalizeAngle,
  type GenericNetEntityState,
} from "@/shared/game/entities/base";
import type {
  PartialServerState,
  ServerStateEvent,
} from "@/shared/network/events";

export type LocalEntityState = GenericNetEntityState & {
  extrapolated?: boolean;
  interpolated?: boolean;
};

export type WorldState = {
  serverTime: number;
  entities: Map<string, LocalEntityState>;
};

export class SnapshotBuffer {
  #snapshots: WorldState[] = [];
  #maxLength: number;

  constructor(maxLength = 120) {
    this.#maxLength = maxLength;
  }

  add(serverState: ServerStateEvent) {
    const snapshot = this.#generateSnapshot(serverState);

    if (!snapshot) return;

    if (this.#snapshots.length > 0) {
      const last = this.#snapshots[this.#snapshots.length - 1]!;
      if (snapshot.serverTime <= last.serverTime) {
        console.error(
          "Snapshot is out of order",
          snapshot.serverTime,
          "last:",
          last.serverTime
        );
        // Replace duplicates or out-of-order packets
        this.#snapshots[this.#snapshots.length - 1] = snapshot;
        return;
      }
    }

    this.#snapshots.push(snapshot);
    if (this.#snapshots.length > this.#maxLength) {
      this.#snapshots.shift();
    }
  }

  #generateSnapshot(serverState: ServerStateEvent): WorldState | null {
    if (serverState.state.type === "partial") {
      return this.#generatePartialSnapshot(
        serverState.state,
        serverState.serverTime
      );
    }

    return {
      serverTime: serverState.serverTime,
      entities: new Map(
        serverState.state.entities.map((entity) => [entity.id, entity])
      ),
    };
  }

  #generatePartialSnapshot(
    state: PartialServerState,
    serverTime: number
  ): WorldState | null {
    const latestSnapshot = this.getLatest();
    if (!latestSnapshot) return null;

    if (serverTime <= latestSnapshot.serverTime) {
      console.error(
        "Partial snapshot is out of order",
        serverTime,
        "latest:",
        latestSnapshot.serverTime
      );
      // TODO: Handle out of order partial snapshots
      return null;
    }

    const updated = new Map(state.updated.map((entity) => [entity.id, entity]));
    const removed = new Set(state.removed);

    for (const oldEntity of latestSnapshot.entities.values()) {
      if (removed.has(oldEntity.id)) continue;
      if (updated.has(oldEntity.id)) continue;

      const interpolatedEntity = this.#interpolateEntity(
        oldEntity,
        latestSnapshot.serverTime,
        serverTime
      );
      updated.set(interpolatedEntity.id, interpolatedEntity);
    }

    return { serverTime, entities: updated };
  }

  #interpolateEntity(
    oldEntity: GenericNetEntityState,
    oldTime: number,
    newTime: number
  ): LocalEntityState {
    const deltaTime = (newTime - oldTime) / 1000;
    const newX = oldEntity.x + oldEntity.vx * deltaTime;
    const newY = oldEntity.y + oldEntity.vy * deltaTime;
    const newAngle = normalizeAngle(oldEntity.angle + oldEntity.va * deltaTime);

    return {
      ...oldEntity,
      x: newX,
      y: newY,
      angle: newAngle,
      interpolated: true,
    };
  }

  getLatest() {
    return this.#snapshots.at(-1) ?? null;
  }

  clear() {
    this.#snapshots.length = 0;
  }

  getWindow(targetTime: number) {
    if (this.#snapshots.length === 0) {
      return { previous: null, next: null };
    }

    let previous: WorldState | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTime >= targetTime) {
        return {
          previous,
          next: snapshot,
        };
      }
      previous = snapshot;
    }

    return { previous, next: null };
  }
}
