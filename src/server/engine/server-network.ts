import type { GenericNetEntityState } from "@/shared/game/entities/base";
import { level as levelUtils } from "@/shared/game/entities/player";
import { Vector2 } from "@/shared/math/vector";
import type {
  FullServerState,
  NetworkEvent,
  PartialServerState,
  RadarData,
  ReplicatedWorldEvent,
  SnapshotStreamHealth,
  SnapshotStreamMetadata,
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

const MAX_CATCH_UP_FRAMES_PER_SCHEDULER_TICK = 3;
const STRESSED_QUEUE_DEPTH = 2;
const DEGRADED_QUEUE_DEPTH = 5;
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

type QueuedServerFrame = {
  simTick: number;
  serialized: string | Uint8Array;
};

export class ServerPlayer {
  id: string;
  ws: Bun.ServerWebSocket;
  ship: Ship | null = null;
  name: string = "";

  score: number = 0;
  level = levelUtils.levelFromXp(this.score);
  totalScoreToNextLevel = levelUtils.xpTotalForLevel(this.level + 1);
  lastQueuedTick = 0;
  lastDeliveredTick = 0;
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
  outboundFrames: QueuedServerFrame[] = [];

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
  #lastCommittedTick = 0;
  #lastCommittedServerTimeMs = 0;

  #keyframesRate = TPS;
  #radarStatesRate = TPS;
  #schedulerStats = {
    schedulerTicks: 0,
    skippedSlots: 0,
    sentFrames: 0,
    lastSentCommittedTick: 0,
    maxObservedQueueDepth: 0,
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
      outboundQueueDepth: player.outboundFrames.length,
      lastQueuedTick: player.lastQueuedTick,
      lastDeliveredTick: player.lastDeliveredTick,
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
        player.pendingInputs.push(message);
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

        player.name = message.name.trim();
        player.resetScore();
        player.pendingInputs.length = 0;
        player.lastSeenEntityIds.clear();
        this.#resetPlayerReplicationState(player, this.#lastCommittedTick);

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

  beginSimulationTick(_simTick: number) {
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
          ship.fire(inputEvent.input.firingCompensation);
        }
        ship.lastInputSequence = inputEvent.sequence;
      }

      player.pendingInputs.length = 0;
    }
  }

  markTickCommitted(simTick: number) {
    this.#lastCommittedTick = simTick;
    this.#lastCommittedServerTimeMs = this.engine.serverTime;

    const playersData = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      alive: player.isAlive,
    }));

    let radarData: Map<string, RadarData[]> | undefined;

    for (const player of this.#players.values()) {
      if (player.ship?.wasWarped) {
        player.needFullState = true;
      }

      this.#engine.measurePerformance("networkBuildPerPlayerMs", () => {
        const stream = this.#getStreamMetadata(player);
        const includeRadar = this.#shouldIncludeRadar(player, stream);
        if (includeRadar && !radarData) {
          radarData = this.#getRadarData();
        }

        const needFullState = this.#needFullState(player, stream);

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
          player.lastSeenEntityIds = this.#engine.measurePerformance(
            "networkVisibleIdsMs",
            () => this.#getVisibleEntityIds(player)
          );
        }

        const replicatedEvents = this.#engine.measurePerformance(
          "networkBuildEventsMs",
          () => this.#getReplicatedEvents(player, simTick)
        );

        const payload = event({
          type: "server:state",
          serverTime: this.#lastCommittedServerTimeMs,
          simTick,
          tickDuration: this.engine.lastTickDuration,
          stream,
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

        player.outboundFrames.push({
          simTick,
          serialized,
        });
        player.lastQueuedTick = simTick;
        player.networkFrameIndex++;
        this.#schedulerStats.maxObservedQueueDepth = Math.max(
          this.#schedulerStats.maxObservedQueueDepth,
          player.outboundFrames.length
        );
      });
    }

    this.#flushOutboundFrames();
  }

  resetReplicationState() {
    this.#lastCommittedTick = 0;
    this.#lastCommittedServerTimeMs = 0;
    this.#schedulerStats.lastSentCommittedTick = 0;
    this.#schedulerStats.maxObservedQueueDepth = 0;

    for (const player of this.#players.values()) {
      this.#resetPlayerReplicationState(player, 0);
      player.pendingInputs.length = 0;
    }

    this.engine.world.clearReplicatedEvents();
  }

  getSchedulerStats() {
    const queueDepths = this.players.map((player) => player.outboundFrames.length);
    const pendingQueueDepth =
      queueDepths.length > 0 ? Math.max(...queueDepths) : 0;

    return {
      ...this.#schedulerStats,
      lastCommittedTick: this.#lastCommittedTick,
      lastCommittedServerTimeMs:
        Math.round(this.#lastCommittedServerTimeMs * 100) / 100,
      pendingQueueDepth,
    };
  }

  #flushOutboundFrames() {
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

      let sentFramesThisTick = 0;
      let lastSentCommittedTick = this.#schedulerStats.lastSentCommittedTick;

      for (const player of this.#players.values()) {
        let catchUpFrames = 0;

        while (
          player.outboundFrames.length > 0 &&
          catchUpFrames < MAX_CATCH_UP_FRAMES_PER_SCHEDULER_TICK
        ) {
          const frame = player.outboundFrames.shift();
          if (!frame) {
            break;
          }

          this.#engine.measurePerformance("wsSendMs", () => {
            player.ws.send(frame.serialized);
          });

          player.lastDeliveredTick = frame.simTick;
          catchUpFrames++;
          sentFramesThisTick++;
          lastSentCommittedTick = Math.max(lastSentCommittedTick, frame.simTick);
        }
      }

      if (sentFramesThisTick === 0) {
        this.#schedulerStats.skippedSlots++;
        return;
      }

      this.#schedulerStats.sentFrames += sentFramesThisTick;
      this.#schedulerStats.lastSentCommittedTick = lastSentCommittedTick;

      const slowestDeliveredTick = this.#getSlowestPlayerLastDeliveredTick();
      if (slowestDeliveredTick !== null) {
        this.engine.world.pruneReplicatedEventsThrough(slowestDeliveredTick);
      }
    });
  }

  #resetPlayerReplicationState(player: ServerPlayer, baseTick: number) {
    player.lastQueuedTick = baseTick;
    player.lastDeliveredTick = baseTick;
    player.networkFrameIndex = 0;
    player.needFullState = true;
    player.lastSeenEntityIds.clear();
    player.outboundFrames.length = 0;
  }

  #needFullState(
    player: ServerPlayer,
    stream: SnapshotStreamMetadata
  ): boolean {
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

  #getFullState(player: ServerPlayer): FullServerState {
    const { queryPos, queryRadius } = this.#calculateCameraViewBounds(player);

    const visibleEntities = this.engine.world.query(queryPos, queryRadius).array();

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

    const allEntities = this.engine.world
      .query(queryPos, queryRadius, true)
      .array();

    const currentVisibleIds = new Set<string>();
    for (const entity of allEntities) {
      if (!entity.removed) {
        currentVisibleIds.add(entity.id);
      }
    }

    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip && !playerShip.removed) {
        currentVisibleIds.add(playerShip.id);
      }
    }

    const updated: GenericNetEntityState[] = [];
    const removedSet = new Set<string>();

    for (const entityId of player.lastSeenEntityIds) {
      if (!currentVisibleIds.has(entityId)) {
        removedSet.add(entityId);
      }
    }

    for (const entity of allEntities) {
      if (entity.removed) {
        if (player.lastSeenEntityIds.has(entity.id)) {
          removedSet.add(entity.id);
        }
      } else {
        const wasPreviouslyVisible = player.lastSeenEntityIds.has(entity.id);
        const isNewlyVisible = !wasPreviouslyVisible;
        const hasChanged = entity.lastChangedTick > player.lastQueuedTick;

        if (isNewlyVisible || hasChanged) {
          updated.push(entity.toJSON());
        }
      }
    }

    if (player.ship && !this.#playerInView(player, queryPos, queryRadius)) {
      const playerShip = this.#engine.world.find(player.ship.id);
      if (playerShip) {
        if (playerShip.removed) {
          removedSet.add(playerShip.id);
        } else {
          const wasPreviouslyVisible = player.lastSeenEntityIds.has(
            playerShip.id
          );
          const hasChanged = playerShip.lastChangedTick > player.lastQueuedTick;
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

    const visibleEntities = this.engine.world.query(queryPos, queryRadius).array();

    const visibleIds = new Set<string>();
    for (const entity of visibleEntities) {
      visibleIds.add(entity.id);
    }

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
      player.lastQueuedTick,
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

  #getSlowestPlayerLastDeliveredTick() {
    let slowestTick: number | null = null;

    for (const player of this.#players.values()) {
      slowestTick =
        slowestTick === null
          ? player.lastDeliveredTick
          : Math.min(slowestTick, player.lastDeliveredTick);
    }

    return slowestTick;
  }

  #getStreamMetadata(player: ServerPlayer): SnapshotStreamMetadata {
    const queueDepth = player.outboundFrames.length;
    let health: SnapshotStreamHealth = "normal";

    if (queueDepth >= DEGRADED_QUEUE_DEPTH) {
      health = "degraded";
    } else if (queueDepth >= STRESSED_QUEUE_DEPTH) {
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
      degradedFeatures:
        Object.keys(degradedFeatures).length > 0 ? degradedFeatures : undefined,
    };
  }

  #getKeyframeRate(stream: SnapshotStreamMetadata) {
    const relaxedMultiplier =
      stream.degradedFeatures?.keyframesRelaxed === true
        ? MAX_KEYFRAME_RATE_MULTIPLIER
        : 1;
    return Math.max(1, this.#keyframesRate * relaxedMultiplier);
  }

  #shouldIncludeRadar(
    player: ServerPlayer,
    stream: SnapshotStreamMetadata
  ): boolean {
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
