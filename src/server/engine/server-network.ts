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

  lastSeenEntityIds = new Set<string>();

  constructor(ws: Bun.ServerWebSocket) {
    const id = crypto.randomUUID();

    this.id = id;
    this.ws = ws;
  }

  addScore(points: number) {
    this.score += points;
    // Send score event to the player
    this.ws.send(
      event({
        type: "player:score",
        score: this.score,
      }).serialize()
    );
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

    // If victim is a ship but no killer, still reset their score
    if (entity instanceof Ship) {
      const victim = this.#playerByShipId.get(entity.id);
      if (victim) victim.resetScore();
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

        // Reset visibility tracking on respawn
        player.lastSeenEntityIds.clear();

        // Create new ship with player's name
        const newShip = new Ship({ id: player.id, name: player.name });
        newShip.position = new Vector2(
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius,
          Math.random() * this.engine.world.borderRadius * 2 -
            this.engine.world.borderRadius
        );
        newShip.player = player;
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

      let state: FullServerState | PartialServerState;
      if (needFullState) {
        state = this.#getFullState(player);
        // Update tracking with full state entities
        player.lastSeenEntityIds = new Set(
          state.entities.map((entity) => entity.id)
        );
      } else {
        state = this.#getPartialState(player);
        // Update tracking with currently visible entities
        const visibleIds = this.#getVisibleEntityIds(player);
        player.lastSeenEntityIds = visibleIds;
      }

      player.ws.send(
        event({
          type: "server:state",
          serverTime: this.engine.serverTime,
          tickDuration: this.engine.lastTickDuration,
          state,
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
      const expandedWidth = player.cameraViewBounds.width * 1.25;
      const expandedHeight = player.cameraViewBounds.height * 1.25;

      return {
        queryRadius: Math.min(
          Math.max(expandedWidth, expandedHeight) / 2,
          1300
        ),
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

    // Get ALL entities in view (including removed ones)
    const allEntities = this.engine.world
      .query(queryPos, queryRadius, true)
      .array();

    // Build set of currently visible entity IDs (non-removed entities)
    const currentVisibleIds = new Set<string>();
    for (const entity of allEntities) {
      if (!entity.removed) {
        currentVisibleIds.add(entity.id);
      }
    }

    // Handle player's own ship if it's not in view
    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip) {
        if (!playerShip.removed) {
          currentVisibleIds.add(playerShip.id);
        }
      }
    }

    const updated: GenericNetEntityState[] = [];
    const removedSet = new Set<string>();

    // Find entities that disappeared from view (were seen before but not now)
    for (const entityId of player.lastSeenEntityIds) {
      if (!currentVisibleIds.has(entityId)) {
        // Entity is no longer visible, add to removed
        removedSet.add(entityId);
      }
    }

    // Process all entities in view
    for (const entity of allEntities) {
      if (entity.removed) {
        // Entity was removed and was previously visible
        if (player.lastSeenEntityIds.has(entity.id)) {
          removedSet.add(entity.id);
        }
      } else {
        // Entity is still alive
        const wasPreviouslyVisible = player.lastSeenEntityIds.has(entity.id);
        const isNewlyVisible = !wasPreviouslyVisible;
        const hasChanged = entity.changed;

        if (isNewlyVisible || hasChanged) {
          // Newly appeared entity or entity that changed, add to updated
          updated.push(entity.toJSON());
        }
      }
    }

    // Handle player's own ship if it's not in view
    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip) {
        if (playerShip.removed) {
          removedSet.add(playerShip.id);
        } else {
          // Always include player ship updates if not in view
          const wasPreviouslyVisible = player.lastSeenEntityIds.has(
            playerShip.id
          );
          const hasChanged = playerShip.changed;
          if (!wasPreviouslyVisible || hasChanged) {
            updated.push(playerShip.toJSON());
          }
        }
      }
    }

    return {
      type: "partial",
      updated,
      removed: Array.from(removedSet),
    };
  }

  #playerInView(player: ServerPlayer, queryPos: Vector2, queryRadius: number) {
    if (!player.ship) return false;
    return player.ship.position.distance(queryPos) < queryRadius;
  }

  #getVisibleEntityIds(player: ServerPlayer): Set<string> {
    const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);

    const visibleEntities = this.engine.world
      .query(queryPos, queryRadius)
      .array();

    const visibleIds = new Set<string>();
    for (const entity of visibleEntities) {
      visibleIds.add(entity.id);
    }

    // Always include player's own ship if it exists
    if (player.ship) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip && !playerShip.removed) {
        visibleIds.add(playerShip.id);
      }
    }

    return visibleIds;
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
