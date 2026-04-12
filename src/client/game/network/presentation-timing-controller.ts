import type {
  ServerStateEvent,
  SnapshotStreamHealth,
} from "@/shared/network/events";

const STREAM_HEALTH_ORDER: Record<SnapshotStreamHealth, number> = {
  normal: 0,
  stressed: 1,
  degraded: 2,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const average = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

export type PresentationWindowObservation = {
  predictedServerTime: number;
  latestSnapshotServerTime: number | null;
  hasNextSnapshot: boolean;
  dtMs: number;
};

/**
 * Tracks snapshot arrival quality and produces adaptive presentation timing.
 *
 * This controller intentionally keeps simulation and presentation separate:
 * reconciliation stays tick-based, while render delay reacts to the effective
 * authoritative stream cadence and starvation.
 */
export class PresentationTimingController {
  #renderDelayMs = 100;
  #arrivalIntervalsMs: number[] = [];
  #serverFrameIntervalsMs: number[] = [];
  #maxSamples = 30;
  #lastArrivalAtMs: number | null = null;
  #lastServerFrameTimeMs: number | null = null;
  #localHealth: SnapshotStreamHealth = "normal";
  #serverEscalation: SnapshotStreamHealth = "normal";
  #starvationDurationMs = 0;
  #latestSnapshotAgeMs: number | null = null;
  #bufferLeadMs: number | null = null;

  get renderDelayMs() {
    return this.#renderDelayMs;
  }

  get localHealth() {
    return this.#localHealth;
  }

  get effectiveHealth(): SnapshotStreamHealth {
    return STREAM_HEALTH_ORDER[this.#serverEscalation] >
      STREAM_HEALTH_ORDER[this.#localHealth]
      ? this.#serverEscalation
      : this.#localHealth;
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

  observeSnapshot(serverState: ServerStateEvent, receivedAtMs: number) {
    if (this.#lastArrivalAtMs !== null) {
      this.#pushSample(
        this.#arrivalIntervalsMs,
        Math.max(0, receivedAtMs - this.#lastArrivalAtMs)
      );
    }
    this.#lastArrivalAtMs = receivedAtMs;

    if (this.#lastServerFrameTimeMs !== null) {
      this.#pushSample(
        this.#serverFrameIntervalsMs,
        Math.max(0, serverState.serverTime - this.#lastServerFrameTimeMs)
      );
    }
    this.#lastServerFrameTimeMs = serverState.serverTime;

    if (serverState.stream?.health) {
      this.#serverEscalation = serverState.stream.health;
    }
  }

  updateWindow({
    predictedServerTime,
    latestSnapshotServerTime,
    hasNextSnapshot,
    dtMs,
  }: PresentationWindowObservation) {
    if (latestSnapshotServerTime === null) {
      this.#latestSnapshotAgeMs = null;
      this.#bufferLeadMs = null;
      this.#starvationDurationMs = 0;
      this.#localHealth = "normal";
      return;
    }

    const latestAgeMs = Math.max(
      0,
      predictedServerTime - latestSnapshotServerTime
    );
    const currentLeadMs = this.#renderDelayMs - latestAgeMs;

    this.#latestSnapshotAgeMs = latestAgeMs;
    this.#bufferLeadMs = currentLeadMs;

    const isStarved = !hasNextSnapshot && currentLeadMs < 0;
    this.#starvationDurationMs = isStarved
      ? this.#starvationDurationMs + dtMs
      : 0;

    const averageArrivalIntervalMs = average(this.#arrivalIntervalsMs) ?? 50;
    const averageServerFrameIntervalMs =
      average(this.#serverFrameIntervalsMs) ?? 50;
    const baseCadenceMs = Math.max(
      averageArrivalIntervalMs,
      averageServerFrameIntervalMs
    );
    const healthMarginMs = this.#getHealthMarginMs(this.effectiveHealth);
    const starvationTargetMs = isStarved ? latestAgeMs + healthMarginMs : 0;
    const cadenceTargetMs = baseCadenceMs + healthMarginMs;
    const targetDelayMs = clamp(
      Math.max(100, cadenceTargetMs, starvationTargetMs),
      100,
      450
    );

    const riseStrength = clamp(dtMs / 140, 0.08, 0.45);
    const fallStrength = clamp(dtMs / 550, 0.02, 0.12);
    const blendStrength =
      targetDelayMs > this.#renderDelayMs ? riseStrength : fallStrength;
    this.#renderDelayMs +=
      (targetDelayMs - this.#renderDelayMs) * blendStrength;

    this.#localHealth = this.#resolveLocalHealth({
      latestAgeMs,
      baseCadenceMs,
      isStarved,
    });
  }

  reset() {
    this.#renderDelayMs = 100;
    this.#arrivalIntervalsMs.length = 0;
    this.#serverFrameIntervalsMs.length = 0;
    this.#lastArrivalAtMs = null;
    this.#lastServerFrameTimeMs = null;
    this.#localHealth = "normal";
    this.#serverEscalation = "normal";
    this.#starvationDurationMs = 0;
    this.#latestSnapshotAgeMs = null;
    this.#bufferLeadMs = null;
  }

  #resolveLocalHealth(args: {
    latestAgeMs: number;
    baseCadenceMs: number;
    isStarved: boolean;
  }): SnapshotStreamHealth {
    const { latestAgeMs, baseCadenceMs, isStarved } = args;

    if (
      this.#starvationDurationMs >= 300 ||
      latestAgeMs >= baseCadenceMs * 3.5 ||
      (isStarved && latestAgeMs >= 250)
    ) {
      return "degraded";
    }

    if (
      this.#starvationDurationMs > 0 ||
      latestAgeMs >= baseCadenceMs * 2.25 ||
      this.#bufferLeadMs !== null && this.#bufferLeadMs < 25
    ) {
      return "stressed";
    }

    return "normal";
  }

  #getHealthMarginMs(health: SnapshotStreamHealth) {
    switch (health) {
      case "degraded":
        return 70;
      case "stressed":
        return 45;
      default:
        return 30;
    }
  }

  #pushSample(samples: number[], value: number) {
    samples.push(value);
    if (samples.length > this.#maxSamples) {
      samples.shift();
    }
  }
}
