import type { GenericNetEntityState } from "@/shared/game/entities/base";
import { Vector2 } from "@/shared/math/vector";
import type {
  FullServerState,
  NetworkEvent,
  PartialServerState,
  ServerStateEvent,
} from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { TPS } from "./constants";
import type { Engine } from "./engine";
import type { BaseEntity } from "./entities/base-entity";
import { Bullet } from "./entities/bullet";
import { LivingEntity } from "./entities/living-entity";
import { Ship } from "./entities/ship";
import type { World } from "./world/world";

export class ServerPlayer {
  id: string;
  ws: Bun.ServerWebSocket;
  ship: Ship | null = null;
  name: string = "";
  score: number = 0;

  needFullState = true;

  cameraViewBounds: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  } | null = null;

  constructor(ws: Bun.ServerWebSocket) {
    const id = crypto.randomUUID();

    this.id = id;
    this.ws = ws;
  }

  addScore(points: number) {
    this.score += points;
  }

  resetScore() {
    this.score = 0;
  }

  get isAlive() {
    return this.ship !== null && !this.ship.removed;
  }
}

export class ServerNetwork {
  #players = new Map<Bun.ServerWebSocket, ServerPlayer>();
  #playerById = new Map<string, ServerPlayer>();
  #playerByShipId = new Map<string, ServerPlayer>();
  #engine: Engine;
  #bunServer: Bun.Server<undefined> | null = null;

  #keyframesRate = TPS;
  #radarStatesRate = TPS;

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

  getPlayerById(playerId: string): ServerPlayer | undefined {
    return this.#playerById.get(playerId);
  }

  getPlayerByShipId(shipId: string): ServerPlayer | undefined {
    return this.#playerByShipId.get(shipId);
  }

  validatePlayerName(
    name: string,
    currentPlayerId?: string
  ): { valid: boolean; reason?: string } {
    // Trim and check length
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return { valid: false, reason: "Name cannot be empty" };
    }
    if (trimmedName.length > 20) {
      return { valid: false, reason: "Name too long (max 20 characters)" };
    }
    if (trimmedName.length < 2) {
      return { valid: false, reason: "Name too short (min 2 characters)" };
    }

    // Check for forbidden phrases (case insensitive)
    const forbiddenPhrases = ["admin", "moderator", "server", "system", "bot"];
    const lowerName = trimmedName.toLowerCase();
    for (const phrase of forbiddenPhrases) {
      if (lowerName.includes(phrase)) {
        return { valid: false, reason: "Name contains forbidden word" };
      }
    }

    // Check if name is already taken by another player
    for (const player of this.#players.values()) {
      if (
        player.id !== currentPlayerId &&
        player.name.toLowerCase() === lowerName
      ) {
        return { valid: false, reason: "Name already taken" };
      }
    }

    return { valid: true };
  }

  handleEntityDestroyed(world: World, entity: BaseEntity, source?: BaseEntity) {
    let killerPlayerId: string | undefined;
    let earnedScore: number | undefined;
    let victimPlayerId: string | undefined;

    // Determine the killer player
    if (source instanceof Bullet && source.owner) {
      const ownerPlayer = this.#playerByShipId.get(source.owner.id);
      if (ownerPlayer) {
        killerPlayerId = ownerPlayer.id;
      }
    } else if (source instanceof Ship) {
      const sourcePlayer = this.#playerByShipId.get(source.id);
      if (sourcePlayer) {
        killerPlayerId = sourcePlayer.id;
      }
    }

    // Award points if there's a killer
    if (killerPlayerId && entity instanceof LivingEntity) {
      const killer = this.#playerById.get(killerPlayerId);
      if (killer) {
        let points = entity.earnablePoints;

        // If victim is a ship, calculate dynamic points
        if (entity instanceof Ship) {
          const victim = this.#playerByShipId.get(entity.id);
          if (victim) {
            victimPlayerId = victim.id;
            points = Math.floor(10 + victim.score / 100);
            // Reset victim's score
            victim.resetScore();
          }
        }

        killer.addScore(points);
        earnedScore = killer.score;
      }
    }

    // If victim is a ship but no killer, still reset their score
    if (entity instanceof Ship && !victimPlayerId) {
      const victim = this.#playerByShipId.get(entity.id);
      if (victim) {
        victim.resetScore();
      }
    }

    // Broadcast entity destroy event
    world.broadcast(
      event({
        type: "entity:destroy",
        entityId: entity.id,
        x: entity.position.x,
        y: entity.position.y,
        sourceId: source?.id,
        playerId: killerPlayerId,
        score: earnedScore,
      })
    );
  }

  connectPlayer(ws: Bun.ServerWebSocket) {
    const player = new ServerPlayer(ws);
    this.#players.set(ws, player);
    this.#playerById.set(player.id, player);

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

    if (player.ship) {
      this.#playerByShipId.delete(player.ship.id);
      player.ship.remove();
    }
    this.#players.delete(ws);
    this.#playerById.delete(player.id);

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
        player.ship.markChanged();

        if (message.input.thrust !== undefined) {
          player.ship.thrust = !!message.input.thrust;
        }
        if (message.input.angle !== undefined) {
          player.ship.angle = message.input.angle;
        }
        if (message.input.fire) {
          player.ship.fire(message.input.firingCompensation);
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

      case "player:camera-bounds":
        player.cameraViewBounds = message.viewBounds;
        console.log(
          "camera bounds",
          message.viewBounds.centerX,
          message.viewBounds.centerY
        );
        break;

      case "player:respawn":
        if (player.ship && !player.ship.removed) break;

        // Validate player name
        const validation = this.validatePlayerName(message.name, player.id);
        if (!validation.valid) {
          ws.send(
            event({
              type: "server:respawn-denied",
              reason: validation.reason || "Invalid name",
            }).serialize()
          );
          break;
        }

        // Set player name and reset score
        player.name = message.name.trim();
        player.resetScore();

        // Create new ship with player's name
        const newShip = new Ship({ id: player.id, name: player.name });
        newShip.position = new Vector2(
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius,
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius
        );
        this.engine.world.spawn(newShip);
        player.ship = newShip;
        player.needFullState = true;
        this.#playerByShipId.set(newShip.id, player);

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

    // Build players summary for leaderboard
    const playersData = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      alive: p.isAlive,
    }));

    const radarData =
      this.engine.tick % this.#radarStatesRate === 0
        ? this.#getRadarData()
        : undefined;

    for (const player of this.#players.values()) {
      const needFullState = this.#needFullState(player);
      if (needFullState) {
        console.log("full state");
      }

      player.ws.send(
        event({
          type: "server:state",
          serverTime: this.engine.serverTime,
          tickDuration: this.engine.lastTickDuration,
          state: needFullState
            ? this.#getFullState(player)
            : this.#getPartialState(player),
          radar: radarData?.get(player.id),
          players: playersData,
        }).serialize({ compress: !this.#engine.debug.disableCompression })
      );
    }
  }

  #needFullState(player: ServerPlayer) {
    const fullStateRequested = player.needFullState;
    player.needFullState = false;

    return (
      this.#engine.debug.disablePartialStateUpdates ||
      fullStateRequested ||
      player.ship?.wasWarped ||
      this.engine.tick % this.#keyframesRate === 0
    );
  }

  #getFullState(player: ServerPlayer): FullServerState {
    const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);

    const visibleEntities = this.engine.world
      .query(queryPos, queryRadius)
      .array();

    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip && !playerShip.removed) {
        visibleEntities.push(playerShip);
      }
    }

    return {
      type: "full",
      entities: visibleEntities.map((entity) => entity.toJSON()),
    };
  }

  #calculateCameraViewBounds(player: ServerPlayer) {
    if (player.cameraViewBounds) {
      // Use camera view bounds with 10% offset
      const expandedWidth = player.cameraViewBounds.width * 1.1;
      const expandedHeight = player.cameraViewBounds.height * 1.1;
      return {
        queryRadius: Math.max(expandedWidth, expandedHeight) / 2,
        queryPos: new Vector2(
          player.cameraViewBounds.centerX,
          player.cameraViewBounds.centerY
        ),
      };
    }

    // Fallback to player position with fixed radius
    return {
      queryPos: player.ship?.position ?? Vector2.ZERO,
      queryRadius: 900,
    };
  }

  #getPartialState(player: ServerPlayer): PartialServerState {
    const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);

    const visibleEntities = this.engine.world
      .queryChanged(queryPos, queryRadius)
      .array();

    const updated: GenericNetEntityState[] = [];
    const removed: string[] = [];

    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip) {
        if (playerShip.removed) {
          removed.push(playerShip.id);
        } else {
          updated.push(playerShip.toJSON());
        }
      }
    }

    for (const entity of visibleEntities) {
      if (entity.removed) {
        removed.push(entity.id);
      } else {
        updated.push(entity.toJSON());
      }
    }

    return {
      type: "partial",
      updated,
      removed,
    };
  }

  #playerInView(player: ServerPlayer, queryPos: Vector2, queryRadius: number) {
    if (!player.ship) return false;
    return player.ship.position.distance(queryPos) < queryRadius;
  }

  #getRadarData() {
    const radarData = new Map<string, NonNullable<ServerStateEvent["radar"]>>();

    // Get all alive players
    const alivePlayers = this.players.filter((p) => p.isAlive);

    // Send radar data to each alive player
    for (const player of alivePlayers) {
      const playerRadarData: Array<{
        type: "player" | "ship";
        x: number;
        y: number;
      }> = [];

      for (const p of alivePlayers) {
        if (!p.ship) continue;

        playerRadarData.push({
          type: p.id === player.id ? "player" : "ship",
          x: Math.round(p.ship.position.x * 10) / 10,
          y: Math.round(p.ship.position.y * 10) / 10,
        });
      }

      radarData.set(player.id, playerRadarData);
    }

    return radarData;
  }

  disconnectAllPlayers() {
    for (const player of this.#players.values()) {
      this.disconnectPlayer(player.ws);
    }
  }
}
