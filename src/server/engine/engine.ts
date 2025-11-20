import { Vector2 } from "@/shared/math/vector";
import type { NetworkEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { DT_MS, TPS } from "./constants";
import { Ship } from "./entities/ship";
import { World } from "./world/world";

export class Engine {
  debug = {
    collisions: false,
    lifecycle: false,
  };

  network: EngineNetwork;

  #world = new World();
  #running = false;
  #tick = 0;
  #startTime = 0;
  #lastTime = 0;
  #accumulatedTime = 0;

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

  constructor() {
    this.network = new EngineNetwork(this);
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

  #update(dt: number) {
    this.#tick++;
    this.#world.update(dt);
    this.network.sendServerState();

    if (this.network.playerCount === 0) {
      this.stop();
    }
  }
}

class EngineNetwork {
  #players = new Map<Bun.ServerWebSocket, ServerPlayer>();
  #engine: Engine;
  #bunServer: Bun.Server<undefined> | null = null;

  get engine() {
    return this.#engine;
  }

  get players() {
    return Array.from(this.#players.values());
  }

  get playerCount() {
    return this.#players.size;
  }

  constructor(engine: Engine) {
    this.#engine = engine;
  }

  connectPlayer(ws: Bun.ServerWebSocket) {
    const player = new ServerPlayer(ws);
    this.#players.set(ws, player);

    if (!this.engine.running) {
      this.engine.start();
    }

    ws.send(
      event({
        type: "server:player-initialize",
        playerId: player.id,
        tps: TPS,
        worldRadius: this.engine.world.borderRadius,
      }).serialize()
    );
  }

  disconnectPlayer(ws: Bun.ServerWebSocket) {
    ws.close();

    const player = this.#players.get(ws);
    if (!player) return;

    player.ship?.remove();
    this.#players.delete(ws);

    console.log(`player disconnected: ${player.id}`);
  }

  onMessage(ws: Bun.ServerWebSocket, message: NetworkEvent) {
    const player = this.#players.get(ws);
    if (!player) {
      ws.close();
      return;
    }

    switch (message.type) {
      case "player:input":
        if (!player.ship || player.ship.removed) break;

        if (message.input.thrust !== undefined) {
          player.ship.thrust = !!message.input.thrust;
        }
        if (message.input.angle !== undefined) {
          player.ship.angle = message.input.angle;
        }
        if (message.input.fire) {
          player.ship.fire();
        }
        player.ship.lastInputSequence = message.sequence;

        break;

      case "player:ping":
        ws.send(
          event({
            type: "server:pong",
            sequence: message.sequence,
            clientTime: message.clientTime,
            serverTime: this.engine.serverTime,
          }).serialize()
        );

        break;

      case "player:respawn":
        if (player.ship && !player.ship.removed) break;

        const newShip = new Ship({ id: player.id });
        newShip.setPosition(
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius,
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius
        );
        this.engine.world.spawn(newShip);
        player.ship = newShip;

        break;
    }
  }

  initialize(bunServer: Bun.Server<undefined>) {
    this.#bunServer = bunServer;
  }

  sendServerState() {
    if (!this.#bunServer) {
      throw new Error("Bun server not set");
    }

    if (this.#players.size === 0) return;

    for (const player of this.#players.values()) {
      const playerPos = player.ship?.position ?? Vector2.ZERO;
      const visibleEntities = this.engine.world.query(playerPos, 900).array();

      player.ws.send(
        event({
          type: "server:state",
          serverTime: this.engine.serverTime,
          entities: visibleEntities.map((entity) => entity.toJSON()),
        }).serialize()
      );
    }
  }

  disconnectAllPlayers() {
    for (const player of this.#players.values()) {
      this.disconnectPlayer(player.ws);
    }
  }
}

class ServerPlayer {
  id: string;
  ws: Bun.ServerWebSocket;
  ship: Ship | null = null;

  constructor(ws: Bun.ServerWebSocket) {
    const id = crypto.randomUUID();

    this.id = id;
    this.ws = ws;
  }
}
