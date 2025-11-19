import type { NetworkEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { DT_MS, TPS } from "./constants";
import { replayBulletFromSnapshots } from "./lag-compensation/bullet-replay";
import { Ship } from "./entities/ship";
import { World } from "./world/world";
import {
  WorldSnapshotBuffer,
  type WorldSnapshot,
} from "./world/snapshot-buffer";

const SNAPSHOT_HISTORY_MS = 200;

export class Engine {
  network: EngineNetwork;

  #world = new World();
  #running = false;
  #tick = 0;
  #startTime = 0;
  #lastTime = 0;
  #accumulatedTime = 0;
  #snapshotBuffer = new WorldSnapshotBuffer(SNAPSHOT_HISTORY_MS);

  static SNAPSHOT_HISTORY_MS = SNAPSHOT_HISTORY_MS;

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

  get snapshotHistoryMs() {
    return SNAPSHOT_HISTORY_MS;
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
    this.#snapshotBuffer.clear();
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

  recordWorldSnapshot(snapshot: WorldSnapshot) {
    this.#snapshotBuffer.record(snapshot);
  }

  getSnapshotAtOrBefore(time: number) {
    return this.#snapshotBuffer.getSnapshotAtOrBefore(time);
  }

  getSnapshotRange(startTime: number, endTime: number) {
    return this.#snapshotBuffer.getRange(startTime, endTime);
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
    ws.close();

    const player = this.#players.get(ws);
    if (!player) return;

    player.ship.remove();
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
        if (player.ship.removed) break;

        if (message.input.thrust !== undefined) {
          player.ship.thrust = !!message.input.thrust;
        }
        if (message.input.angle !== undefined) {
          player.ship.angle = message.input.angle;
        }
        if (message.input.fire) {
          const handled = this.#handleFireCommand(player, message.latencyMs);
          if (!handled) {
            player.ship.fire();
          }
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
    const serverTime = this.engine.serverTime;

    this.engine.recordWorldSnapshot({
      serverTime,
      tick: this.engine.tick,
      entities,
    });

    this.#bunServer.publish(
      "server:state",
      event({
        type: "server:state",
        serverTime,
        entities,
      }).serialize()
    );
  }

  disconnectAllPlayers() {
    for (const player of this.#players.values()) {
      this.disconnectPlayer(player.ws);
    }
  }

  #handleFireCommand(player: ServerPlayer, latencyMs?: number) {
    if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) {
      return false;
    }

    const now = this.engine.serverTime;
    const historyMs = this.engine.snapshotHistoryMs;
    // latencyMs is the RTT, so we divide by 2 to get one-way latency
    const oneWayLatency = latencyMs / 2;
    const clampedLatency = Math.min(Math.max(oneWayLatency, 0), historyMs);
    const targetTime = now - clampedLatency;

    const startSnapshot =
      this.engine.getSnapshotAtOrBefore(targetTime) ??
      this.engine.getSnapshotAtOrBefore(now);
    if (!startSnapshot) {
      return false;
    }

    const shipSnapshot = startSnapshot.entities.find(
      (entity) => entity.id === player.ship.id && entity.type === "ship"
    );
    if (!shipSnapshot) {
      return false;
    }

    const snapshots = this.engine.getSnapshotRange(
      startSnapshot.serverTime,
      now
    );
    const bullet = replayBulletFromSnapshots({
      shooterId: player.ship.id,
      startSnapshot,
      shipSnapshot,
      snapshots,
      worldEntities: this.engine.world.entities,
      now,
    });

    if (!bullet) {
      return false;
    }

    this.engine.world.spawn(bullet);
    return true;
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
