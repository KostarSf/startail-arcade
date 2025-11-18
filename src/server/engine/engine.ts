import type { NetworkEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { TPS } from "./constants";
import { Ship } from "./entities/ship";
import { World } from "./world/world";

export class Engine {
  network: EngineNetwork;

  #world = new World();
  #interval: NodeJS.Timeout | null = null;

  get world() {
    return this.#world;
  }

  get running() {
    return !!this.#interval;
  }

  constructor() {
    this.network = new EngineNetwork(this);
  }

  start() {
    this.#interval = setInterval(() => {
      this.#world.update(1 / TPS);
      this.network.sendServerState();
    }, 1000 / TPS);
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = null;
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

  constructor(engine: Engine) {
    this.#engine = engine;
  }

  connectPlayer(ws: Bun.ServerWebSocket) {
    const player = new ServerPlayer(ws);
    player.ship.setPosition(Math.random() * 200, Math.random() * 200);
    this.#players.set(ws, player);
    this.engine.world.spawn(player.ship);

    if (!this.engine.running) {
      this.engine.start();
    }

    ws.subscribe("server:state");
    ws.send(
      event({
        type: "server:player-initialize",
        playerId: player.id,
        tps: TPS,
      }).serialize()
    );
  }

  disconnectPlayer(ws: Bun.ServerWebSocket) {
    const player = this.#players.get(ws);
    if (!player) return;

    player.ship.remove();
    this.#players.delete(ws);
  }

  onMessage(ws: Bun.ServerWebSocket, message: NetworkEvent) {
    const player = this.#players.get(ws);
    if (!player) return;

    switch (message.type) {
      case "player:input":
        if (player.ship.removed) break;

        if (message.input.thrust !== undefined) {
          player.ship.thrust = !!message.input.thrust;
        }
        if (message.input.angle !== undefined) {
          player.ship.angle = message.input.angle;
        }
        if (message.input.fire !== undefined) {
          player.ship.fire();
        }

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

    const entities = this.engine.world.entities.map((entity) =>
      entity.toJSON()
    );

    this.#bunServer.publish(
      "server:state",
      event({ type: "server:state", entities }).serialize()
    );
  }

  disconnectAllPlayers() {
    for (const player of this.#players.values()) {
      this.disconnectPlayer(player.ws);
    }
    this.engine.stop();
    this.engine.world.clear();
  }
}

class ServerPlayer {
  id: string;
  ws: Bun.ServerWebSocket;
  ship: Ship;

  constructor(ws: Bun.ServerWebSocket) {
    const id = crypto.randomUUID();

    this.id = id;
    this.ws = ws;
    this.ship = new Ship({ id });
  }
}
