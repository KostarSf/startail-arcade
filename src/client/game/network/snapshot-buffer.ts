import type { ServerStateEvent } from "@/shared/network/events";

export type ServerSnapshot = ServerStateEvent;

export class SnapshotBuffer {
  #snapshots: ServerSnapshot[] = [];
  #maxLength: number;

  constructor(maxLength = 120) {
    this.#maxLength = maxLength;
  }

  add(snapshot: ServerSnapshot) {
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

  getWindow(targetTime: number) {
    if (this.#snapshots.length === 0) {
      return { previous: null, next: null };
    }

    let previous: ServerSnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTime >= targetTime) {
        return { previous, next: snapshot };
      }
      previous = snapshot;
    }

    return { previous, next: null };
  }
}
