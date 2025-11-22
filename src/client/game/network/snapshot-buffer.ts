import type { GenericNetEntityState } from "@/shared/game/entities/base";
import type { ServerStateEvent } from "@/shared/network/events";

export type ServerSnapshot = ServerStateEvent;

export type WorldState = {
  serverTime: number;
  entities: GenericNetEntityState[];
};

export class SnapshotBuffer {
  #snapshots: ServerSnapshot[] = [];
  #maxLength: number;

  constructor(maxLength = 120) {
    this.#maxLength = maxLength;
  }

  add(snapshot: ServerSnapshot) {
    if (snapshot.state.type === "partial") {
      // TODO: Добавить обработку дельта пакетов
      return;
    }

    if (this.#snapshots.length > 0) {
      const last = this.#snapshots[this.#snapshots.length - 1]!;
      if (snapshot.serverTime <= last.serverTime) {
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

  getLatest() {
    return this.#snapshots.at(-1) ?? null;
  }

  clear() {
    this.#snapshots.length = 0;
  }

  getWindow(targetTime: number): {
    previous: WorldState | null;
    next: WorldState | null;
  } {
    if (this.#snapshots.length === 0) {
      return { previous: null, next: null };
    }

    let previous: ServerSnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.state.type === "partial") {
        // TODO: Добавить обработку дельта пакетов
        continue;
      }

      if (snapshot.serverTime >= targetTime) {
        return {
          previous:
            previous && previous.state.type === "full"
              ? {
                  serverTime: previous.serverTime,
                  entities: previous.state.entities,
                }
              : null,
          next: {
            serverTime: snapshot.serverTime,
            entities: snapshot.state.entities,
          },
        };
      }
      previous = snapshot;
    }

    return {
      previous:
        previous && previous.state.type === "full"
          ? {
              serverTime: previous.serverTime,
              entities: previous.state.entities,
            }
          : null,
      next: null,
    };
  }
}
