import {
  integrateExpMagnetism,
  integrateMotion,
  type GenericNetEntityState,
} from "@/shared/game/entities/base";
import { SHIP_CONSTANTS } from "@/shared/game/entities/ship";
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

    const deltaTime = (serverTime - latestSnapshot.serverTime) / 1000;
    this.#interpolateExpOrbs(latestSnapshot, updated, removed, deltaTime);

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

  /** Магнитим орбы опыта вокруг кораблей, для которых не пришло состояние с сервера. */
  #interpolateExpOrbs(
    oldSnapshot: WorldState,
    updated: Map<string, LocalEntityState>,
    removed: Set<string>,
    deltaTime: number
  ) {
    const expEntities = new Map<string, GenericNetEntityState>();
    const shipEntities = new Map<string, GenericNetEntityState>();

    for (const old of oldSnapshot.entities.values()) {
      if (removed.has(old.id)) continue;

      if (updated.has(old.id)) {
        const entity = updated.get(old.id);
        if (entity?.type === "ship") {
          shipEntities.set(entity.id, entity);
        }

        continue;
      }

      if (old.type === "exp") {
        expEntities.set(old.id, old);
      } else if (old.type === "ship") {
        shipEntities.set(old.id, old);
      }
    }

    for (const ship of shipEntities.values()) {
      const magnetRadius = (ship.radius ?? SHIP_CONSTANTS.radius) * 15;
      for (const exp of expEntities.values()) {
        integrateExpMagnetism(exp, ship, magnetRadius, deltaTime);
      }
    }
  }

  #interpolateEntity(
    oldEntity: GenericNetEntityState,
    oldTime: number,
    newTime: number
  ): LocalEntityState {
    const deltaTime = (newTime - oldTime) / 1000;

    const interpolatedEntity: LocalEntityState = {
      ...oldEntity,
      interpolated: true,
    };
    integrateMotion(interpolatedEntity, deltaTime);

    return interpolatedEntity;
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
