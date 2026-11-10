import { Asteroid } from "./entities/asteroid";
import { ITEM_CONFIG } from "@/shared/game/items";
import { Pickup } from "./entities/pickup";
import { level as levelUtils } from "@/shared/game/entities/player";
import { Vector2 } from "@/shared/math/vector";
import { wrappedDistance } from "@/shared/math/world-wrap";
import type {
  FullServerState,
  NetworkEvent,
  PartialServerState,
  RadarData,
  ReplicatedWorldEvent,
  SnapshotStreamHealth,
  SnapshotStreamMetadata,
  ShotResult,
} from "@/shared/network/events";
import { event } from "@/shared/network/utils";
import { DT_MS, TPS } from "./constants";
import type { Engine } from "./engine";
import type { BaseEntity } from "./entities/base-entity";
import { Bullet } from "./entities/bullet";
import { Ship } from "./entities/ship";
import type { World } from "./world/world";

export const MAX_CAMERA_QUERY_RADIUS = 1300;
export const DEFAULT_CAMERA_QUERY_RADIUS = 900;

const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_UNSENT_TICKS = TPS * 10;
const MAX_KEYFRAME_RATE_MULTIPLIER = 2;
const MAX_RADAR_RATE_MULTIPLIER = 3;

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
      queryRadius: Math.min(Math.max(expandedWidth, expandedHeight) / 2, MAX_CAMERA_QUERY_RADIUS),
      queryPos: new Vector2(player.cameraViewBounds.centerX, player.cameraViewBounds.centerY),
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
  lastAcceptedTick = 0;
  networkFrameIndex = 0;

  needFullState = true;

  cameraViewBounds: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  } | null = null;

  lastSeenEntityIds = new Set<string>();
  pendingInputs: Extract<NetworkEvent, { type: "player:input" }>[] = [];
  pendingShotResults: ShotResult[] = [];
  lastReceivedInputSequence = -1;

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

      // Preserve health and energy percentages when max values increase.
      this.ship.adjustStatsForLevelUp(oldMaxHealth, oldMaxEnergy);

      console.log(
        "player leveled up",
        this.name,
        this.level,
        this.ship.maxHealth,
        this.ship.maxEnergy,
        this.ship.energyRechargeRate,
        this.ship.baseDamage,
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
  #lastCommittedTick = 0;
  #lastCommittedServerTimeMs = 0;

  #lastFlushAt = -Infinity;

  #keyframesRate = TPS;
  #radarStatesRate = TPS;
  #schedulerStats = {
    schedulerTicks: 0,
    skippedSlots: 0,
    sentFrames: 0,
    lastSentCommittedTick: 0,
    maxObservedQueueDepth: 0,
    coalescedTicks: 0,
    backpressureSkips: 0,
    droppedFrames: 0,
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
      outboundQueueDepth: 0,
      bufferedBytes: player.ws.getBufferedAmount(),
      lastSentTick: player.lastSentTick,
      lastAcceptedTick: player.lastAcceptedTick,
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

  validatePlayerName(name: string, currentPlayerId?: string): { valid: boolean; reason?: string } {
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

    const forbiddenPhrases = ["admin", "moderator", "server", "system", "bot"];
    const lowerName = trimmedName.toLowerCase();
    for (const phrase of forbiddenPhrases) {
      if (lowerName.includes(phrase)) {
        return { valid: false, reason: "Name contains forbidden word" };
      }
    }

    for (const player of this.#players.values()) {
      if (player.id !== currentPlayerId && player.name.toLowerCase() === lowerName) {
        return { valid: false, reason: "Name already taken" };
      }
    }

    return { valid: true };
  }

  handleEntityDestroyed(world: World, entity: BaseEntity, source?: BaseEntity) {
    let killerPlayerId: string | undefined;

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
    this.#resetPlayerReplicationState(player, this.#lastCommittedTick);
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
      }).serialize(),
    );
  }

  disconnectPlayer(ws: Bun.ServerWebSocket) {
    const player = this.#players.get(ws);
    if (!player) return;

    if (player.ship) {
      this.#playerByShipId.delete(player.ship.id);
      player.ship.remove();
    }
    this.#players.delete(ws);
    this.#playerById.delete(player.id);
    // Remove registry entries before close: transports may invoke close callbacks synchronously.
    ws.close();
    if (this.#players.size === 0) this.engine.stop();

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
        if (
          !Number.isSafeInteger(message.sequence) ||
          message.sequence <= player.lastReceivedInputSequence
        )
          break;
        player.lastReceivedInputSequence = message.sequence;
        if (message.input.shotId !== undefined && message.input.shotId !== message.sequence) break;
        if (!player.ship || player.ship.removed) {
          if (message.input.fire && message.input.shotId !== undefined)
            player.pendingShotResults.push({ shotId: message.input.shotId, status: "rejected" });
          break;
        }
        player.pendingInputs.push(message);
        break;

      case "player:ping":
        ws.send(
          event({
            type: "server:pong",
            sequence: message.sequence,
            clientTime: message.clientTime,
            serverTime: this.engine.serverTime,
          }).serialize(),
        );

        break;

      case "player:camera-bounds":
        if (
          message.viewBounds &&
          Object.values(message.viewBounds).every(Number.isFinite) &&
          message.viewBounds.width > 0 &&
          message.viewBounds.height > 0
        )
          player.cameraViewBounds = message.viewBounds;
        break;

      case "player:respawn":
        if (player.ship && !player.ship.removed) break;

        const validation = this.validatePlayerName(message.name, player.id);
        if (!validation.valid) {
          ws.send(
            event({
              type: "server:respawn-denied",
              reason: validation.reason || "Invalid name",
            }).serialize(),
          );
          break;
        }

        player.name = message.name.trim();
        player.resetScore();
        player.pendingInputs.length = 0;
        player.lastSeenEntityIds.clear();
        this.#resetPlayerReplicationState(player, this.#lastCommittedTick);

        const newShip = new Ship({ id: player.id, name: player.name });
        newShip.position = new Vector2(
          Math.random() * this.engine.world.borderRadius * 2 - this.engine.world.borderRadius,
          Math.random() * this.engine.world.borderRadius * 2 - this.engine.world.borderRadius,
        );
        newShip.player = player;
        this.engine.world.spawn(newShip);
        player.ship = newShip;
        player.needFullState = true;
        this.#playerByShipId.set(newShip.id, player);

        break;
    }
  }

  beginSimulationTick(simTick: number) {
    for (const player of this.#players.values()) {
      const ship = player.ship;
      if (!ship || ship.removed || player.pendingInputs.length === 0) {
        continue;
      }

      ship.markChanged();

      for (const inputEvent of player.pendingInputs) {
        if (inputEvent.input.thrust !== undefined) {
          ship.thrust = !!inputEvent.input.thrust;
        }
        if (inputEvent.input.angle !== undefined) {
          ship.angle = inputEvent.input.angle;
        }
        if (inputEvent.input.fire) {
          const accepted = ship.fire(
            inputEvent.input.firingCompensation,
            inputEvent.input.shotId,
            simTick,
          );
          if (!accepted && inputEvent.input.shotId !== undefined)
            player.pendingShotResults.push({ shotId: inputEvent.input.shotId, status: "rejected" });
        }
        ship.lastInputSequence = inputEvent.sequence;
      }

      player.pendingInputs.length = 0;
    }
  }

  markTickCommitted(simTick: number) {
    this.#lastCommittedTick = simTick;
    this.#lastCommittedServerTimeMs = simTick * DT_MS;
  }

  /** At most one current snapshot per transport slot, after all catch-up ticks. */
  flushCommittedState(now = performance.now()) {
    const simTick = this.#lastCommittedTick;
    if (simTick === 0 || now - this.#lastFlushAt < DT_MS) return;
    this.#lastFlushAt = now;
    this.#schedulerStats.schedulerTicks++;
    const playersData = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      alive: player.isAlive,
    }));
    let radarData: Map<string, RadarData[]> | undefined;
    let sent = 0;
    for (const player of this.#players.values()) {
      if (player.lastSentTick === simTick) continue;
      // Bound event retention for a peer that cannot consume the stream.
      if (simTick - player.lastAcceptedTick > MAX_UNSENT_TICKS) {
        this.disconnectPlayer(player.ws);
        continue;
      }
      const bufferedBytes = player.ws.getBufferedAmount();
      if (bufferedBytes > 0) {
        this.#schedulerStats.backpressureSkips++;
        continue;
      }
      this.#engine.measurePerformance("networkBuildPerPlayerMs", () => {
        const stream = this.#getStreamMetadata(player);
        const includeRadar = this.#shouldIncludeRadar(player, stream);
        if (includeRadar && !radarData) radarData = this.#getRadarData();
        const needFullState = this.#needFullState(player, stream);
        // A single visibility query supplies the payload and its next baseline.
        const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);
        const visible = this.engine.world
          .query(queryPos, queryRadius)
          .array()
          .filter((entity) => !(entity instanceof Ship) || entity.initialized);
        if (
          player.ship &&
          player.ship.initialized &&
          !player.ship.removed &&
          !visible.includes(player.ship)
        ) {
          visible.push(player.ship);
        }
        const visibleIds = new Set(visible.map((entity) => entity.id));
        // The owner needs a complete lifetime, including shots outside camera interest.
        for (const entity of this.engine.world.nonAsteroidEntities) {
          if (
            entity instanceof Bullet &&
            entity.ownerId === player.id &&
            entity.shotId !== undefined &&
            !entity.removed &&
            !visibleIds.has(entity.id)
          ) {
            visible.push(entity);
            visibleIds.add(entity.id);
          }
        }
        const state: FullServerState | PartialServerState = needFullState
          ? { type: "full", entities: visible.map((entity) => entity.toJSON()) }
          : {
              type: "partial",
              updated: visible
                .filter(
                  (entity) =>
                    !player.lastSeenEntityIds.has(entity.id) ||
                    (entity instanceof Bullet &&
                      entity.ownerId === player.id &&
                      entity.shotId !== undefined) ||
                    entity.lastChangedTick > player.lastSentTick,
                )
                .map((entity) => entity.toJSON()),
              removed: [...player.lastSeenEntityIds].filter((id) => !visibleIds.has(id)),
            };
        const replicatedEvents = this.#engine.measurePerformance("networkBuildEventsMs", () =>
          this.#getReplicatedEvents(player, simTick),
        );
        const payload = event({
          type: "server:state",
          serverTime: this.#lastCommittedServerTimeMs,
          simTick,
          baseSimTick: needFullState ? null : player.lastSentTick,
          tickDuration: this.engine.lastTickDuration,
          stream,
          state,
          events: replicatedEvents,
          shots: player.pendingShotResults.length ? player.pendingShotResults : undefined,
          radar: includeRadar ? radarData?.get(player.id) : undefined,
          players: playersData,
        });
        const serialized = this.#engine.measurePerformance("networkSerializeMs", () =>
          payload.serialize({ compress: !this.#engine.debug.disableCompression }),
        );
        const result = this.#engine.measurePerformance("wsSendMs", () =>
          player.ws.send(serialized),
        );
        if (result === 0) {
          // A dropped frame must not advance the delta or event baseline.
          player.needFullState = true;
          this.#schedulerStats.droppedFrames++;
          return;
        }
        // -1 means accepted into Bun's ordered transport buffer, not dropped.
        this.#schedulerStats.coalescedTicks += Math.max(0, simTick - player.lastSentTick - 1);
        player.lastSeenEntityIds = visibleIds;
        player.pendingShotResults.length = 0;
        player.lastSentTick = simTick;
        player.lastAcceptedTick = simTick;
        player.networkFrameIndex++;
        sent++;
      });
    }
    this.#schedulerStats.sentFrames += sent;
    if (sent > 0) this.#schedulerStats.lastSentCommittedTick = simTick;
    else this.#schedulerStats.skippedSlots++;
    const oldest = this.#getSlowestPlayerLastDeliveredTick();
    if (oldest !== null) this.engine.world.pruneReplicatedEventsThrough(oldest);
    else this.engine.world.clearReplicatedEvents();
  }

  resetReplicationState() {
    this.#lastCommittedTick = 0;
    this.#lastCommittedServerTimeMs = 0;
    this.#lastFlushAt = -Infinity;
    Object.assign(this.#schedulerStats, {
      schedulerTicks: 0,
      skippedSlots: 0,
      sentFrames: 0,
      lastSentCommittedTick: 0,
      maxObservedQueueDepth: 0,
      coalescedTicks: 0,
      backpressureSkips: 0,
      droppedFrames: 0,
    });
    for (const player of this.#players.values()) {
      this.#resetPlayerReplicationState(player, 0);
      player.pendingInputs.length = 0;
    }
    this.engine.world.clearReplicatedEvents();
  }

  getSchedulerStats() {
    return {
      ...this.#schedulerStats,
      lastCommittedTick: this.#lastCommittedTick,
      lastCommittedServerTimeMs: this.#lastCommittedServerTimeMs,
      pendingQueueDepth: 0,
      bufferedBytes: Math.max(0, ...this.players.map((p) => p.ws.getBufferedAmount())),
    };
  }

  #resetPlayerReplicationState(player: ServerPlayer, baseTick: number) {
    player.lastSentTick = baseTick;
    player.lastAcceptedTick = baseTick;
    player.networkFrameIndex = 0;
    player.needFullState = true;
    player.lastSeenEntityIds.clear();
  }

  #needFullState(player: ServerPlayer, stream: SnapshotStreamMetadata): boolean {
    const fullStateRequested = player.needFullState;
    player.needFullState = false;

    if (this.#engine.debug.disablePartialStateUpdates) {
      return true;
    }

    if (fullStateRequested) {
      return true;
    }

    const keyframeRate = this.#getKeyframeRate(stream);
    return player.networkFrameIndex % keyframeRate === 0;
  }

  #calculateCameraViewBounds(player: ServerPlayer) {
    return getPlayerCameraQueryBounds(player);
  }

  #getReplicatedEvents(player: ServerPlayer, committedTick: number): ReplicatedWorldEvent[] {
    const tickEvents = this.engine.world.getReplicatedEventsInRange(
      player.lastSentTick,
      committedTick,
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
    },
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
    return (
      wrappedDistance(queryPos, { x: event.x, y: event.y }, this.engine.world.borderRadius) <=
      queryRadius
    );
  }

  #getSlowestPlayerLastDeliveredTick() {
    let slowestTick: number | null = null;

    for (const player of this.#players.values()) {
      slowestTick =
        slowestTick === null
          ? player.lastAcceptedTick
          : Math.min(slowestTick, player.lastAcceptedTick);
    }

    return slowestTick;
  }

  #getStreamMetadata(player: ServerPlayer): SnapshotStreamMetadata {
    const bufferedBytes = player.ws.getBufferedAmount();
    const lagTicks = this.#lastCommittedTick - player.lastSentTick;
    let health: SnapshotStreamHealth = "normal";

    if (bufferedBytes >= MAX_BUFFERED_BYTES || lagTicks >= 5) {
      health = "degraded";
    } else if (bufferedBytes > 0 || lagTicks >= 3) {
      health = "stressed";
    }

    const degradedFeatures: SnapshotStreamMetadata["degradedFeatures"] = {};
    if (health !== "normal") {
      degradedFeatures.radarReduced = true;
    }
    if (health === "degraded") {
      degradedFeatures.keyframesRelaxed = true;
    }

    return {
      health,
      degradedFeatures: Object.keys(degradedFeatures).length > 0 ? degradedFeatures : undefined,
    };
  }

  #getKeyframeRate(stream: SnapshotStreamMetadata) {
    const relaxedMultiplier =
      stream.degradedFeatures?.keyframesRelaxed === true ? MAX_KEYFRAME_RATE_MULTIPLIER : 1;
    return Math.max(1, this.#keyframesRate * relaxedMultiplier);
  }

  #shouldIncludeRadar(player: ServerPlayer, stream: SnapshotStreamMetadata): boolean {
    const radarMultiplier =
      stream.health === "degraded"
        ? MAX_RADAR_RATE_MULTIPLIER
        : stream.health === "stressed"
          ? 2
          : 1;
    const radarRate = Math.max(1, this.#radarStatesRate * radarMultiplier);
    return player.networkFrameIndex % radarRate === 0;
  }

  #getRadarData() {
    const radarData = new Map<string, RadarData[]>();

    const includeAllAsteroids = false;

    const allEntities = this.engine.world.nonAsteroidEntities;
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

    const alivePlayers = this.players.filter((p) => p.isAlive);

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
      if (player.ship) {
        const world = this.engine.world;
        for (const entity of world
          .query(player.ship.position, ITEM_CONFIG.radarRadius)
          .precise()
          .array()) {
          const type =
            entity instanceof Pickup
              ? "repair"
              : entity instanceof Asteroid && entity.itemKind === "repair"
                ? "repair-asteroid"
                : null;
          if (type) playerRadarData.push({ type, x: entity.x, y: entity.y });
        }
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
