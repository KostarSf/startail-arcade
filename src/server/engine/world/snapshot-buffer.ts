import type { ServerStateEvent } from "@/shared/network/events";

export interface WorldSnapshot {
  serverTime: number;
  tick: number;
  entities: ServerStateEvent["entities"];
}

export class WorldSnapshotBuffer {
  #snapshots: WorldSnapshot[] = [];
  #maxAgeMs: number;

  constructor(maxAgeMs: number) {
    this.#maxAgeMs = maxAgeMs;
  }

  record(snapshot: WorldSnapshot) {
    this.#snapshots.push(snapshot);
    this.#trim(snapshot.serverTime - this.#maxAgeMs);
  }

  getSnapshotAtOrBefore(targetTime: number) {
    for (let i = this.#snapshots.length - 1; i >= 0; i--) {
      const snapshot = this.#snapshots[i]!;
      if (snapshot.serverTime <= targetTime) {
        return snapshot;
      }
    }
    return null;
  }

  getRange(startTime: number, endTime: number) {
    const result: WorldSnapshot[] = [];
    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTime <= startTime) {
        continue;
      }
      if (snapshot.serverTime > endTime) {
        break;
      }
      result.push(snapshot);
    }
    return result;
  }

  clear() {
    this.#snapshots.length = 0;
  }

  #trim(minTime: number) {
    if (this.#snapshots.length === 0) return;
    while (
      this.#snapshots.length > 0 &&
      this.#snapshots[0]!.serverTime < minTime
    ) {
      this.#snapshots.shift();
    }
  }
}
