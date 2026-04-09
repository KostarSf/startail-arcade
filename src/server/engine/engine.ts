import { DT_MS, TPS } from "./constants";
import { ServerNetwork } from "./server-network";
import { World } from "./world/world";

export type PerformanceMetric =
  | "entityUpdateMs"
  | "entityPreUpdateMs"
  | "entityUpdateAsteroidMs"
  | "entityUpdateShipMs"
  | "entityUpdateBulletMs"
  | "entityUpdateExpMs"
  | "entityUpdateOtherMs"
  | "gridUpdateMs"
  | "entityRemovalQueueMs"
  | "collisionMs"
  | "collisionDiscreteMs"
  | "collisionContinuousMs"
  | "collisionProcessEventsMs"
  | "collisionPairDecodeMs"
  | "collisionRemoveEntityMs"
  | "networkSerializeMs"
  | "networkBuildFullStateMs"
  | "networkBuildPartialStateMs"
  | "networkVisibleIdsMs"
  | "wsSendMs";

type PerformanceWindow = { ticks: number } & Record<PerformanceMetric, number>;

export type PerformanceSummary = {
  ticks: number;
  elapsedMs: number;
  averagesMs: Record<PerformanceMetric, number>;
};

export class Engine {
  debug = {
    collisions: false,
    lifecycle: false,
    ticksDuration: false,
    asteroids: false,
    pirates: false,
    performanceBreakdown: false,
    disablePartialStateUpdates: false,
    disableCompression: false,
  };

  network: ServerNetwork;

  #world = new World();
  #running = false;
  #tick = 0;
  #startTime = 0;
  #lastTime = 0;
  #accumulatedTime = 0;
  #lastTickDuration = 0;
  #performanceWindowStartedAt = 0;
  #performanceWindow: PerformanceWindow = this.#createEmptyPerformanceWindow();
  #lastPerformanceSummary: PerformanceSummary | null = null;

  get tick() {
    return this.#tick;
  }

  get world() {
    return this.#world;
  }

  get running() {
    return this.#running;
  }

  get serverTime() {
    return performance.now() - this.#startTime;
  }

  get lastTickDuration() {
    return this.#lastTickDuration;
  }

  get lastPerformanceSummary() {
    return this.#lastPerformanceSummary;
  }

  constructor() {
    this.network = new ServerNetwork(this);
  }

  start() {
    if (this.#running) return;
    this.#running = true;

    this.#startTime = performance.now();
    this.#lastTime = this.#startTime;
    this.#accumulatedTime = 0;
    this.#performanceWindowStartedAt = this.#startTime;
    this.#resetPerformanceWindow();

    this.#world.initialize(this);

    const loop = () => {
      if (!this.#running) return;

      const now = performance.now();
      let frameTime = now - this.#lastTime;
      this.#lastTime = now;

      const MAX_FRAME_TIME = 250; //ms
      if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

      this.#accumulatedTime += frameTime;

      while (this.#accumulatedTime >= DT_MS) {
        this.#update(1 / TPS);
        this.#accumulatedTime -= DT_MS;
      }

      setImmediate(loop);
    };

    console.log("engine started");
    loop();
  }

  stop() {
    this.#running = false;
    this.world.clear();
    this.#tick = 0;
    this.#lastTickDuration = 0;
    this.#resetPerformanceWindow();

    console.log("engine stopped");
  }

  #ticksWithoutPlayers = 0;
  #MAX_TICKS_WITHOUT_PLAYERS = TPS * 60;

  #update(dt: number) {
    const tickStart = performance.now();

    if (this.debug.ticksDuration) {
      console.log(
        "limit:",
        dt * 1000,
        "\tactual:",
        Math.round(this.lastTickDuration * 100) / 100,
        "\tavailable:",
        Math.floor(dt * 1000 - this.lastTickDuration)
      );
    }

    this.#tick++;
    this.#world.update(dt);

    this.network.sendServerState();

    this.#world.postUpdate(dt);

    if (this.network.playerCount === 0) {
      this.#ticksWithoutPlayers++;
      if (this.#ticksWithoutPlayers >= this.#MAX_TICKS_WITHOUT_PLAYERS) {
        console.log(
          `no players for the last ${(
            this.#ticksWithoutPlayers / TPS
          ).toFixed()} seconds, stopping engine`
        );
        this.stop();
      }
    } else {
      this.#ticksWithoutPlayers = 0;
    }

    this.#lastTickDuration = performance.now() - tickStart;
    this.#flushPerformanceWindowIfNeeded();
  }

  measurePerformance<T>(metric: PerformanceMetric, fn: () => T): T {
    if (!this.debug.performanceBreakdown) {
      return fn();
    }

    const startedAt = performance.now();
    const result = fn();
    this.#performanceWindow[metric] += performance.now() - startedAt;

    return result;
  }

  markProfiledTick() {
    if (!this.debug.performanceBreakdown) {
      return;
    }

    this.#performanceWindow.ticks++;
  }

  #flushPerformanceWindowIfNeeded() {
    if (!this.debug.performanceBreakdown) {
      return;
    }

    const now = performance.now();
    const elapsed = now - this.#performanceWindowStartedAt;
    if (elapsed < 1000 || this.#performanceWindow.ticks === 0) {
      return;
    }

    const ticks = this.#performanceWindow.ticks;
    const average = (value: number) => value / ticks;
    const avgMetric = (metric: PerformanceMetric) =>
      average(this.#performanceWindow[metric]).toFixed(2);
    const averagesMs = this.#createAveragesSnapshot(average);

    this.#lastPerformanceSummary = {
      ticks,
      elapsedMs: elapsed,
      averagesMs,
    };

    console.log(
      `[perf] avg over ${ticks} ticks (${(elapsed / 1000).toFixed(1)}s):\n` +
        `  entity update ${avgMetric("entityUpdateMs")}ms ` +
        `(pre ${avgMetric("entityPreUpdateMs")}ms, asteroid ${avgMetric("entityUpdateAsteroidMs")}ms, ` +
        `ship ${avgMetric("entityUpdateShipMs")}ms, bullet ${avgMetric("entityUpdateBulletMs")}ms, ` +
        `exp ${avgMetric("entityUpdateExpMs")}ms, other ${avgMetric("entityUpdateOtherMs")}ms, ` +
        `grid ${avgMetric("gridUpdateMs")}ms, removal queue ${avgMetric("entityRemovalQueueMs")}ms)\n` +
        `  collision ${avgMetric("collisionMs")}ms ` +
        `(discrete ${avgMetric("collisionDiscreteMs")}ms, continuous ${avgMetric("collisionContinuousMs")}ms, ` +
        `process events ${avgMetric("collisionProcessEventsMs")}ms, pair decode ${avgMetric("collisionPairDecodeMs")}ms, ` +
        `remove entity ${avgMetric("collisionRemoveEntityMs")}ms)\n` +
        `  network serialize ${avgMetric("networkSerializeMs")}ms ` +
        `(full state ${avgMetric("networkBuildFullStateMs")}ms, partial state ${avgMetric("networkBuildPartialStateMs")}ms, ` +
        `visible ids ${avgMetric("networkVisibleIdsMs")}ms)\n` +
        `  ws send ${avgMetric("wsSendMs")}ms`
    );

    this.#performanceWindowStartedAt = now;
    this.#resetPerformanceWindow();
  }

  #resetPerformanceWindow() {
    this.#performanceWindow = this.#createEmptyPerformanceWindow();
  }

  #createAveragesSnapshot(
    average: (value: number) => number
  ): Record<PerformanceMetric, number> {
    return {
      entityUpdateMs: average(this.#performanceWindow.entityUpdateMs),
      entityPreUpdateMs: average(this.#performanceWindow.entityPreUpdateMs),
      entityUpdateAsteroidMs: average(
        this.#performanceWindow.entityUpdateAsteroidMs
      ),
      entityUpdateShipMs: average(this.#performanceWindow.entityUpdateShipMs),
      entityUpdateBulletMs: average(
        this.#performanceWindow.entityUpdateBulletMs
      ),
      entityUpdateExpMs: average(this.#performanceWindow.entityUpdateExpMs),
      entityUpdateOtherMs: average(this.#performanceWindow.entityUpdateOtherMs),
      gridUpdateMs: average(this.#performanceWindow.gridUpdateMs),
      entityRemovalQueueMs: average(
        this.#performanceWindow.entityRemovalQueueMs
      ),
      collisionMs: average(this.#performanceWindow.collisionMs),
      collisionDiscreteMs: average(this.#performanceWindow.collisionDiscreteMs),
      collisionContinuousMs: average(
        this.#performanceWindow.collisionContinuousMs
      ),
      collisionProcessEventsMs: average(
        this.#performanceWindow.collisionProcessEventsMs
      ),
      collisionPairDecodeMs: average(
        this.#performanceWindow.collisionPairDecodeMs
      ),
      collisionRemoveEntityMs: average(
        this.#performanceWindow.collisionRemoveEntityMs
      ),
      networkSerializeMs: average(this.#performanceWindow.networkSerializeMs),
      networkBuildFullStateMs: average(
        this.#performanceWindow.networkBuildFullStateMs
      ),
      networkBuildPartialStateMs: average(
        this.#performanceWindow.networkBuildPartialStateMs
      ),
      networkVisibleIdsMs: average(this.#performanceWindow.networkVisibleIdsMs),
      wsSendMs: average(this.#performanceWindow.wsSendMs),
    };
  }

  #createEmptyPerformanceWindow(): PerformanceWindow {
    return {
      ticks: 0,
      entityUpdateMs: 0,
      entityPreUpdateMs: 0,
      entityUpdateAsteroidMs: 0,
      entityUpdateShipMs: 0,
      entityUpdateBulletMs: 0,
      entityUpdateExpMs: 0,
      entityUpdateOtherMs: 0,
      gridUpdateMs: 0,
      entityRemovalQueueMs: 0,
      collisionMs: 0,
      collisionDiscreteMs: 0,
      collisionContinuousMs: 0,
      collisionProcessEventsMs: 0,
      collisionPairDecodeMs: 0,
      collisionRemoveEntityMs: 0,
      networkSerializeMs: 0,
      networkBuildFullStateMs: 0,
      networkBuildPartialStateMs: 0,
      networkVisibleIdsMs: 0,
      wsSendMs: 0,
    };
  }
}
