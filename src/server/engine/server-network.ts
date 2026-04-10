import type { GenericNetEntityState } from "@/shared/game/entities/base";
import { level as levelUtils } from "@/shared/game/entities/player";
import { Vector2 } from "@/shared/math/vector";
import type {
  FullServerState,
  NetworkEvent,
  PartialServerState,
  RadarData,
  ReplicatedWorldEvent,
} from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { TPS } from "./constants";
import type { Engine } from "./engine";
import type { BaseEntity } from "./entities/base-entity";
import { Bullet } from "./entities/bullet";
import { Ship } from "./entities/ship";
import type { World } from "./world/world";

export const MAX_CAMERA_QUERY_RADIUS = 1300;
export const DEFAULT_CAMERA_QUERY_RADIUS = 900;

/**
 * Computes the server-authoritative camera query bounds used for visibility
 * and chunk waking.
 */
export function getPlayerCameraQueryBounds(player: {
  cameraViewBounds: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  } | null;
  ship: Ship | null;
}) {
  if (player.cameraViewBounds) {
    const expandedWidth = player.cameraViewBounds.width * 1.25;
    const expandedHeight = player.cameraViewBounds.height * 1.25;

    return {
      queryRadius: Math.min(
        Math.max(expandedWidth, expandedHeight) / 2,
        MAX_CAMERA_QUERY_RADIUS
      ),
      queryPos: new Vector2(
        player.cameraViewBounds.centerX,
        player.cameraViewBounds.centerY
      ),
    };
  }

  return {
    queryPos: player.ship?.position ?? Vector2.ZERO,
    queryRadius: DEFAULT_CAMERA_QUERY_RADIUS,
  };
}

export class ServerPlayer {
  id: string;
  ws: Bun.ServerWebSocket;
  ship: Ship | null = null;
  name: string = "";

  score: number = 0;
  level = levelUtils.levelFromXp(this.score);
  totalScoreToNextLevel = levelUtils.xpTotalForLevel(this.level + 1);
  lastSentTick = 0;
  networkFrameIndex = 0;

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
    if (!this.ship || this.ship.removed) return;

    const previousLevel = this.level;

    this.score += points;
    this.ship.world.emit({
      kind: "player-score",
      replication: "global",
      targetPlayerId: this.id,
      playerId: this.id,
      score: this.score,
      delta: points,
    });
    this.level = levelUtils.levelFromXp(this.score);
    this.totalScoreToNextLevel = levelUtils.xpTotalForLevel(this.level + 1);

    if (previousLevel < this.level) {
      const levelDifference = this.level - previousLevel;
      const oldMaxHealth = this.ship.maxHealth;
      const oldMaxEnergy = this.ship.maxEnergy;

      this.ship.maxHealth += levelDifference * 3;
      this.ship.maxEnergy += levelDifference * 0.4;
      this.ship.energyRechargeRate += levelDifference * 0.1;
      this.ship.baseDamage += 0.25 * levelDifference;
      this.ship.level = this.level;

      // Preserve health and energy percentages when max values increase
      // TODO: Корабль должен сам увеличивать свои stats при повышении уровня, а не нам
      this.ship.adjustStatsForLevelUp(oldMaxHealth, oldMaxEnergy);

      console.log(
        "player leveled up",
        this.name,
        this.level,
        this.ship.maxHealth,
        this.ship.maxEnergy,
        this.ship.energyRechargeRate,
        this.ship.baseDamage
      );

      this.ship.world.emit({
        kind: "player-level-up",
        replication: "global",
        targetPlayerId: this.id,
        playerId: this.id,
        level: this.level,
        score: this.score,
        nextLevelScore: this.totalScoreToNextLevel,
      });
    }
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
  #schedulerTimer: ReturnType<typeof setInterval> | null = null;
  #lastCommittedTick = 0;
  #lastCommittedServerTimeMs = 0;

  #keyframesRate = TPS;
  #radarStatesRate = TPS;
  #schedulerIntervalMs = 1000 / TPS;
  #schedulerStats = {
    schedulerTicks: 0,
    skippedSlots: 0,
    sentFrames: 0,
    lastSentCommittedTick: 0,
  };

  get engine() {
    return this.#engine;
  }

  get players() {
    return Array.from(this.#players.values());
  }

  get playerCount() {
    return this.#players.size;
  }

  getPlayerSnapshots() {
    return this.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      level: player.level,
      alive: player.isAlive,
      shipId: player.ship?.id ?? null,
      position: player.ship
        ? {
            x: Math.round(player.ship.position.x * 10) / 10,
            y: Math.round(player.ship.position.y * 10) / 10,
          }
        : null,
    }));
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

    world.emit({
      kind: "entity-destroy",
      replication: "relevant",
      entityId: entity.id,
      x: entity.position.x,
      y: entity.position.y,
      sourceId: source?.id,
      playerId: killerPlayerId,
    });
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
    this.#startScheduler();
  }

  markTickCommitted(simTick: number) {
    this.#lastCommittedTick = simTick;
    this.#lastCommittedServerTimeMs = this.engine.serverTime;

    for (const player of this.#players.values()) {
      if (player.ship?.wasWarped) {
        player.needFullState = true;
      }
    }
  }

  resetReplicationState() {
    this.#lastCommittedTick = 0;
    this.#schedulerStats.lastSentCommittedTick = 0;

    for (const player of this.#players.values()) {
      player.lastSentTick = 0;
      player.networkFrameIndex = 0;
      player.needFullState = true;
      player.lastSeenEntityIds.clear();
    }

    this.engine.world.clearReplicatedEvents();
  }

  getSchedulerStats() {
    return {
      ...this.#schedulerStats,
      lastCommittedTick: this.#lastCommittedTick,
      lastCommittedServerTimeMs:
        Math.round(this.#lastCommittedServerTimeMs * 100) / 100,
    };
  }

  #startScheduler() {
    if (this.#schedulerTimer) {
      return;
    }

    this.#schedulerTimer = setInterval(() => {
      this.#runSchedulerTick();
    }, this.#schedulerIntervalMs);
  }

  #runSchedulerTick() {
    this.#engine.measurePerformance("networkSchedulerTickMs", () => {
      if (!this.#bunServer) {
        throw new Error("Bun server not set");
      }

      this.#schedulerStats.schedulerTicks++;

      if (this.#players.size === 0) {
        this.engine.world.clearReplicatedEvents();
        this.#schedulerStats.skippedSlots++;
        return;
      }

      const committedTick = this.#lastCommittedTick;
      if (committedTick <= 0) {
        this.#schedulerStats.skippedSlots++;
        return;
      }

      const playersData = this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        alive: p.isAlive,
      }));

      let radarData: Map<string, RadarData[]> | undefined;
      let sentAnyFrame = false;

      for (const player of this.#players.values()) {
        if (committedTick <= player.lastSentTick) {
          continue;
        }

        const includeRadar =
          player.networkFrameIndex % this.#radarStatesRate === 0;
        if (includeRadar && !radarData) {
          radarData = this.#getRadarData();
        }

        this.#engine.measurePerformance("networkBuildPerPlayerMs", () => {
          const needFullState = this.#needFullState(player);

          let state: FullServerState | PartialServerState;
          if (needFullState) {
            state = this.#engine.measurePerformance(
              "networkBuildFullStateMs",
              () => this.#getFullState(player)
            );
            player.lastSeenEntityIds = new Set(
              state.entities.map((entity) => entity.id)
            );
          } else {
            state = this.#engine.measurePerformance(
              "networkBuildPartialStateMs",
              () => this.#getPartialState(player)
            );
            const visibleIds = this.#engine.measurePerformance(
              "networkVisibleIdsMs",
              () => this.#getVisibleEntityIds(player)
            );
            player.lastSeenEntityIds = visibleIds;
          }

          const replicatedEvents = this.#engine.measurePerformance(
            "networkBuildEventsMs",
            () => this.#getReplicatedEvents(player, committedTick)
          );

          const payload = event({
            type: "server:state",
            serverTime: this.#lastCommittedServerTimeMs,
            simTick: committedTick,
            tickDuration: this.engine.lastTickDuration,
            state,
            events: replicatedEvents,
            radar: includeRadar ? radarData?.get(player.id) : undefined,
            players: playersData,
          });
          const serialized = this.#engine.measurePerformance(
            "networkSerializeMs",
            () =>
              payload.serialize({
                compress: !this.#engine.debug.disableCompression,
              })
          );

          this.#engine.measurePerformance("wsSendMs", () => {
            player.ws.send(serialized);
          });

          player.lastSentTick = committedTick;
          player.networkFrameIndex++;
          sentAnyFrame = true;
        });
      }

      if (!sentAnyFrame) {
        this.#schedulerStats.skippedSlots++;
        return;
      }

      this.#schedulerStats.sentFrames++;
      this.#schedulerStats.lastSentCommittedTick = committedTick;

      const slowestPlayerTick = this.#getSlowestPlayerLastSentTick();
      if (slowestPlayerTick !== null) {
        this.engine.world.pruneReplicatedEventsThrough(slowestPlayerTick);
      }
    });
  }

  #needFullState(player: ServerPlayer) {
    const fullStateRequested = player.needFullState;
    player.needFullState = false;

    return (
      this.#engine.debug.disablePartialStateUpdates ||
      fullStateRequested ||
      player.networkFrameIndex % this.#keyframesRate === 0
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
    return getPlayerCameraQueryBounds(player);
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
        const hasChanged = entity.lastChangedTick > player.lastSentTick;

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
          const hasChanged = playerShip.lastChangedTick > player.lastSentTick;
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

  #getReplicatedEvents(
    player: ServerPlayer,
    committedTick: number
  ): ReplicatedWorldEvent[] {
    const tickEvents = this.engine.world.getReplicatedEventsInRange(
      player.lastSentTick,
      committedTick
    );

    const replicatedEvents: ReplicatedWorldEvent[] = [];
    for (const tickEvent of tickEvents) {
      if (!this.#shouldReplicateEventToPlayer(player, tickEvent)) {
        continue;
      }

      const {
        replication: _replication,
        targetPlayerId: _targetPlayerId,
        ...replicatedEvent
      } = tickEvent;
      replicatedEvents.push(replicatedEvent);
    }

    return replicatedEvents;
  }

  #shouldReplicateEventToPlayer(
    player: ServerPlayer,
    event: {
      replication: "none" | "global" | "relevant";
      targetPlayerId?: string;
      x?: number;
      y?: number;
      entityId?: string;
    }
  ) {
    if (event.targetPlayerId && event.targetPlayerId !== player.id) {
      return false;
    }

    if (event.replication === "global") {
      return true;
    }

    if (event.replication !== "relevant") {
      return false;
    }

    if (player.ship && event.entityId === player.ship.id) {
      return true;
    }

    if (typeof event.x !== "number" || typeof event.y !== "number") {
      return false;
    }

    const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);
    const dx = event.x - queryPos.x;
    const dy = event.y - queryPos.y;
    return dx * dx + dy * dy <= queryRadius * queryRadius;
  }

  #getSlowestPlayerLastSentTick() {
    let slowestTick: number | null = null;

    for (const player of this.#players.values()) {
      slowestTick =
        slowestTick === null
          ? player.lastSentTick
          : Math.min(slowestTick, player.lastSentTick);
    }

    return slowestTick;
  }

  #getRadarData() {
    const radarData = new Map<string, RadarData[]>();

    const includeAllAsteroids = false;

    const allEntities = this.engine.world.entities;
    const asteroidRadarData: RadarData[] = [];

    for (const entity of allEntities) {
      if (entity.removed) continue;

      let type: RadarData["type"] | undefined;

      if (entity.type === "asteroid" && includeAllAsteroids) type = "asteroid";
      if (entity instanceof Ship && entity.ai) type = "pirate";

      if (type) {
        asteroidRadarData.push({
          type,
          x: Math.round(entity.position.x * 10) / 10,
          y: Math.round(entity.position.y * 10) / 10,
        });
      }
    }

    // Get all alive players
    const alivePlayers = this.players.filter((p) => p.isAlive);

    // Send radar data to each alive player
    for (const player of alivePlayers) {
      const playerRadarData: RadarData[] = [];

      for (const p of alivePlayers) {
        if (!p.ship) continue;

        playerRadarData.push({
          type: p.id === player.id ? "player" : "ship",
          x: Math.round(p.ship.position.x * 10) / 10,
          y: Math.round(p.ship.position.y * 10) / 10,
        });
      }

      playerRadarData.push(...asteroidRadarData);

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
