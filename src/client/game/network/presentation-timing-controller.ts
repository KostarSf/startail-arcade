import type { ServerStateEvent, SnapshotStreamHealth } from "@/shared/network/events";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const percentile = (values: number[], fraction: number, fallback: number) => {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
};

export type PresentationWindowObservation = {
  predictedServerTime: number;
  latestSnapshotServerTime: number | null;
  hasNextSnapshot: boolean;
  dtMs: number;
};

/** Playback clock advances continuously; packet arrival never assigns its position. */
export class PresentationTimingController {
  #renderTime: number | null = null;
  #renderDelayMs = 100;
  #targetDelayMs = 100;
  #cadenceMs = 50;
  #jitter: number[] = [];
  #intervals: number[] = [];
  #lastArrival: number | null = null;
  #lastServerTime: number | null = null;
  #serverHealth: SnapshotStreamHealth = "normal";
  #localHealth: SnapshotStreamHealth = "normal";
  #starvationDurationMs = 0;
  #latestSnapshotAgeMs: number | null = null;
  #bufferLeadMs: number | null = null;

  get renderTime() {
    return this.#renderTime;
  }
  get renderDelayMs() {
    return this.#renderDelayMs;
  }
  get localHealth() {
    return this.#localHealth;
  }
  get effectiveHealth(): SnapshotStreamHealth {
    const order = { normal: 0, stressed: 1, degraded: 2 };
    return order[this.#localHealth] >= order[this.#serverHealth]
      ? this.#localHealth
      : this.#serverHealth;
  }
  get starvationDurationMs() {
    return this.#starvationDurationMs;
  }
  get latestSnapshotAgeMs() {
    return this.#latestSnapshotAgeMs;
  }
  get bufferLeadMs() {
    return this.#bufferLeadMs;
  }

  observeSnapshot(state: ServerStateEvent, receivedAtMs: number) {
    if (this.#lastServerTime !== null && state.serverTime <= this.#lastServerTime) return;
    if (this.#lastArrival !== null && this.#lastServerTime !== null) {
      const elapsed = state.serverTime - this.#lastServerTime;
      this.#intervals.push(elapsed);
      this.#jitter.push(Math.max(0, receivedAtMs - this.#lastArrival - elapsed));
      if (this.#intervals.length > 60) this.#intervals.shift();
      if (this.#jitter.length > 60) this.#jitter.shift();
      this.#cadenceMs = percentile(this.#intervals, 0.5, 50);
      this.#targetDelayMs = clamp(
        2 * this.#cadenceMs + percentile(this.#jitter, 0.95, 0),
        100,
        400,
      );
    }
    this.#lastArrival = receivedAtMs;
    this.#lastServerTime = state.serverTime;
    this.#serverHealth = state.stream?.health ?? "normal";
  }

  updateWindow({
    predictedServerTime,
    latestSnapshotServerTime: latest,
    dtMs,
  }: PresentationWindowObservation) {
    if (latest === null) return this.#renderTime;
    const dt = clamp(dtMs, 0, 100);
    if (this.#renderTime === null) {
      this.#renderTime = latest - this.#targetDelayMs;
    } else if (latest - this.#renderTime > Math.max(1000, this.#targetDelayMs * 4)) {
      // Returning from a suspended tab is a discontinuity, not ordinary jitter.
      // Re-anchor once instead of spending minutes replaying obsolete history.
      this.#renderTime = Math.max(this.#renderTime, latest - this.#targetDelayMs);
    } else {
      // Restore buffer occupancy gradually instead of replaying packet bursts.
      const desired = latest - this.#targetDelayMs + this.#cadenceMs / 2;
      const speed = clamp(1 + (desired - this.#renderTime) / 1000, 0.9, 1.1);
      const next = Math.min(this.#renderTime + dt * speed, latest + 60);
      this.#renderTime = Math.max(this.#renderTime, next);
    }
    this.#bufferLeadMs = latest - this.#renderTime;
    this.#latestSnapshotAgeMs = Math.max(0, predictedServerTime - latest);
    this.#renderDelayMs = Math.max(0, predictedServerTime - this.#renderTime);
    this.#starvationDurationMs = this.#bufferLeadMs < 0 ? this.#starvationDurationMs + dt : 0;
    this.#localHealth =
      this.#starvationDurationMs >= 250
        ? "degraded"
        : this.#bufferLeadMs < 25
          ? "stressed"
          : "normal";
    return this.#renderTime;
  }

  reset() {
    this.#renderTime = null;
    this.#renderDelayMs = this.#targetDelayMs = 100;
    this.#cadenceMs = 50;
    this.#jitter.length = this.#intervals.length = 0;
    this.#lastArrival = this.#lastServerTime = null;
    this.#serverHealth = this.#localHealth = "normal";
    this.#starvationDurationMs = 0;
    this.#latestSnapshotAgeMs = this.#bufferLeadMs = null;
  }
}
