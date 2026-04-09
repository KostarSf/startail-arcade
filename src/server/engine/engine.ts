import { DT_MS, TPS } from "./constants";
import { ServerNetwork } from "./server-network";
import { World } from "./world/world";

type PerformanceMetric =
  | "entityUpdateMs"
  | "collisionMs"
  | "networkSerializeMs"
  | "wsSendMs";

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
  #performanceWindow = {
    ticks: 0,
    entityUpdateMs: 0,
    collisionMs: 0,
    networkSerializeMs: 0,
    wsSendMs: 0,
  };

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

    console.log(
      `[perf] avg over ${ticks} ticks (${(elapsed / 1000).toFixed(1)}s): ` +
        `entity update ${average(this.#performanceWindow.entityUpdateMs).toFixed(2)}ms, ` +
        `collision ${average(this.#performanceWindow.collisionMs).toFixed(2)}ms, ` +
        `network serialize ${average(this.#performanceWindow.networkSerializeMs).toFixed(2)}ms, ` +
        `ws send ${average(this.#performanceWindow.wsSendMs).toFixed(2)}ms`
    );

    this.#performanceWindowStartedAt = now;
    this.#resetPerformanceWindow();
  }

  #resetPerformanceWindow() {
    this.#performanceWindow = {
      ticks: 0,
      entityUpdateMs: 0,
      collisionMs: 0,
      networkSerializeMs: 0,
      wsSendMs: 0,
    };
  }
}
