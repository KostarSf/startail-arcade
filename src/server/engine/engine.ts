import { DT_MS, TPS } from "./constants";
import { ServerNetwork } from "./server-network";
import { World } from "./world/world";

export class Engine {
  debug = {
    collisions: false,
    lifecycle: false,
    ticksDuration: false,
    asteroids: false,
    pirates: false,
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
  }
}
