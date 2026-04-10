import { Vector2 } from "@/shared/math/vector";
import type { SerializableEvent } from "@/shared/network/utils";
import { TPS } from "../constants";
import type { Engine } from "../engine";
import { PirateAI } from "../entities/ai/pirate-ai";
import { Asteroid } from "../entities/asteroid";
import type { BaseEntity } from "../entities/base-entity";
import { Ship } from "../entities/ship";
import { ChunkActivityManager } from "./chunk-activity-manager";
import { CollisionResolver } from "./collision-resolver";
import { UniformGrid } from "./uniform-grid";
import { generateWorld } from "./utils/fbm-domain-warp-world-generator";
import type {
  CommittedWorldEvent,
  WorldEvent,
  WorldEventListener,
} from "./world-events";

export class World {
  #entities = new Map<string, BaseEntity>();
  #nonAsteroidEntities = new Set<BaseEntity>();
  #grid = new UniformGrid();
  #chunkActivity = new ChunkActivityManager();
  #collisionResolver = new CollisionResolver();

  #borderRadius = 5000;

  #maxAsteroids = 2500;
  #currentAsteroids = 0;
  #asteroidsRefillInterval = TPS * 5;
  #asteroidsMinBatchCount = 10;
  #asteroidsMaxBatchCount = 50;

  #maxPirates = 5;
  #currentPirates = 0;
  #piratesRefillInterval = TPS * 20;
  #eventsByTick = new Map<number, CommittedWorldEvent[]>();
  #eventListeners = new Set<WorldEventListener>();
  #nextTickEventIndex = 0;

  #engine: Engine | null = null;
  get engine() {
    if (!this.#engine) {
      throw new Error("Engine not initialized");
    }
    return this.#engine;
  }

  get borderRadius() {
    return this.#borderRadius;
  }

  get entities() {
    return Array.from(this.#entities.values());
  }

  /** Exposes chunk activity state for systems that need sleep/awake decisions. */
  get chunkActivity() {
    return this.#chunkActivity;
  }

  /** Returns current entity counts grouped by network/entity type. */
  getEntityCountsByType() {
    const counts: Record<string, number> = {};
    for (const entity of this.#entities.values()) {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    }
    return counts;
  }

  spawn(entity: BaseEntity) {
    if (entity.initialized) {
      throw new Error("Entity already initialized");
    }
    this.#entities.set(entity.id, entity);
    if (!(entity instanceof Asteroid)) {
      this.#nonAsteroidEntities.add(entity);
    }
    this.#grid.update(entity);
    this.#chunkActivity.onSpawn(entity);
  }

  find(id: string) {
    return this.#entities.get(id);
  }

  /**
   * Updates the spatial index and chunk activity index after an entity moved.
   *
   * This is the single place that keeps both indexes in sync.
   */
  updateSpatialIndex(entity: BaseEntity) {
    this.#grid.update(entity);
    this.#chunkActivity.onEntityMoved(entity);
  }

  /** Returns chunk activity counters for debugging, tests, and perf snapshots. */
  getActivityStats() {
    return this.#chunkActivity.getStats();
  }

  onEvent(listener: WorldEventListener) {
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  emit(event: WorldEvent) {
    const simTick = this.engine.tick;
    const committedEvent: CommittedWorldEvent = {
      ...event,
      simTick,
      tickEventIndex: this.#nextTickEventIndex++,
    };

    for (const listener of this.#eventListeners) {
      listener(committedEvent);
    }

    if (committedEvent.replication === "none") {
      return committedEvent;
    }

    let tickEvents = this.#eventsByTick.get(simTick);
    if (!tickEvents) {
      tickEvents = [];
      this.#eventsByTick.set(simTick, tickEvents);
    }
    tickEvents.push(committedEvent);

    return committedEvent;
  }

  getReplicatedEventsInRange(
    startExclusiveTick: number,
    endInclusiveTick: number
  ) {
    const events: CommittedWorldEvent[] = [];
    for (
      let simTick = startExclusiveTick + 1;
      simTick <= endInclusiveTick;
      simTick++
    ) {
      const tickEvents = this.#eventsByTick.get(simTick);
      if (tickEvents) {
        events.push(...tickEvents);
      }
    }

    return events;
  }

  pruneReplicatedEventsThrough(maxInclusiveTick: number) {
    for (const simTick of this.#eventsByTick.keys()) {
      if (simTick <= maxInclusiveTick) {
        this.#eventsByTick.delete(simTick);
      }
    }
  }

  clearReplicatedEvents() {
    this.#eventsByTick.clear();
  }

  /**
   * Iterates entities that participate in collision this tick.
   *
   * Non-asteroids are always included. Asteroids are included only if their
   * activation chunk is currently awake.
   */
  forEachCollisionEntity(fn: (entity: BaseEntity) => void) {
    for (const entity of this.#nonAsteroidEntities) {
      if (!entity.removed) {
        fn(entity);
      }
    }

    for (const asteroid of this.#chunkActivity.getActiveAsteroids()) {
      if (!asteroid.removed) {
        fn(asteroid);
      }
    }
  }

  #asteroidVelocityFactor = Math.max(Math.random() * 140 - 40, 0);
  #asteroidAngleFactor = Math.random() * Math.PI * 2 - Math.PI;

  #getAsteroidSpawnVelocity() {
    return this.#asteroidVelocityFactor > 0
      ? Vector2.RIGHT.mul(Math.random() * this.#asteroidVelocityFactor).rotate(
          Math.random() * Math.PI * 0.5 -
            Math.PI * 0.25 +
            this.#asteroidAngleFactor
        )
      : undefined;
  }

  initialize(engine: Engine) {
    this.#engine = engine;
    this.#chunkActivity.initialize(this);

    const asteroidPositions = generateWorld(
      this.#borderRadius,
      this.#maxAsteroids
    );

    for (const position of asteroidPositions) {
      this.#spawnAsteroid({
        position,
        velocity: this.#getAsteroidSpawnVelocity(),
      });
    }
  }

  #spawnPirate() {
    const position = new Vector2(
      Math.random() * this.#borderRadius * 2 - this.#borderRadius,
      Math.random() * this.#borderRadius * 2 - this.#borderRadius
    );

    const allPlayers = this.engine.network.players;
    for (const player of allPlayers) {
      if (!player.ship || player.ship.removed) continue;

      const distance = player.ship.position.distance(position);
      if (distance < 1000) {
        if (this.engine.debug.pirates) {
          console.log(
            "pirate spawn denied, player too close at distance",
            distance
          );
        }

        return;
      }
    }

    const pirate = new Ship({
      x: position.x,
      y: position.y,
      angle: Math.random() * 2 * Math.PI - Math.PI,
      name: "???",
    });
    pirate.ai = new PirateAI();
    this.spawn(pirate);
    this.#currentPirates++;
  }

  #spawnAsteroid(args?: {
    beyondBorder?: boolean;
    position?: Vector2;
    velocity?: Vector2;
    angle?: number;
    angularVelocity?: number;
  }) {
    const ASTEROID_VELOCITY = 50;
    const ASTEROID_ANGLE_VELOCITY = Math.PI * 0.5;

    const [radius, health, velocityMultiplier] = [
      [8, 20, 4],
      [12, 50, 1],
      [18, 100, 0.4],
    ].at(Math.floor(Math.random() * 3)) as [number, number, number];

    let x = args?.position?.x;
    let y = args?.position?.y;

    if (args?.beyondBorder) {
      const offset = this.#borderRadius + 100;

      const plane = Math.random() < 0.5 ? "x" : "y";
      if (plane === "x") {
        x = Math.random() < 0.5 ? -offset : offset;
        y = Math.random() * offset * 2 - offset;
      } else {
        y = Math.random() < 0.5 ? -offset : offset;
        x = Math.random() * offset * 2 - offset;
      }
    } else {
      x ??= Math.random() * this.#borderRadius * 2 - this.#borderRadius;
      y ??= Math.random() * this.#borderRadius * 2 - this.#borderRadius;
    }

    const angle = args?.angle ?? Math.random() * 2 * Math.PI - Math.PI;
    const vx =
      args?.velocity?.x ??
      (Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2) *
        velocityMultiplier +
        (Math.random() * 10 - 3);
    const vy =
      args?.velocity?.y ??
      (Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2) *
        velocityMultiplier +
        (Math.random() * 20 - 6);
    const va =
      args?.angularVelocity ??
      Math.random() * ASTEROID_ANGLE_VELOCITY - ASTEROID_ANGLE_VELOCITY / 2;
    const asteroid = new Asteroid({
      x,
      y,
      angle,
      vx,
      vy,
      va,
      radius,
      maxHealth: health,
    });
    this.spawn(asteroid);

    this.#currentAsteroids++;
  }

  #removedEntities = new Map<string, BaseEntity>();

  get removedEntities() {
    return Array.from(this.#removedEntities.keys());
  }

  update(delta: number) {
    this.#nextTickEventIndex = 0;
    this.#refillAsteroids();
    this.#refillPirates();

    this.engine.measurePerformance("chunkActivityUpdateMs", () => {
      this.#chunkActivity.beginTick(this, delta);
    });
    this.engine.measurePerformance("wakeStabilizationMs", () => {
      this.#chunkActivity.applyWakeStabilization(this);
    });

    this.engine.measurePerformance("entityUpdateMs", () => {
      this.#forEachSimulatedEntity((entity) => {
        if (!entity.initialized) {
          entity.initialize(this);
        }

        this.engine.measurePerformance("entityPreUpdateMs", () => {
          entity.preUpdate(this, delta);
        });
      });

      this.#forEachSimulatedEntity((entity) => {
        if (!entity.removed) {
          this.engine.measurePerformance(
            this.#getEntityUpdateMetric(entity),
            () => {
              entity.update(this, delta);
            }
          );
          this.engine.measurePerformance("gridUpdateMs", () => {
            this.updateSpatialIndex(entity);
          });
        }

        if (entity.removed) {
          this.engine.measurePerformance("entityRemovalQueueMs", () => {
            this.#removedEntities.set(entity.id, entity);
            entity.onRemove(this);
          });
        }
      });
    });

    this.engine.measurePerformance("collisionMs", () => {
      this.#collisionResolver.update(this);
    });
    this.engine.markProfiledTick();
  }

  postUpdate(delta: number) {
    for (const entity of this.#removedEntities.values()) {
      this.#collisionResolver.removeEntity(this, entity);
      this.#chunkActivity.onRemove(entity);
      this.#entities.delete(entity.id);
      this.#nonAsteroidEntities.delete(entity);
      this.#grid.remove(entity);

      if (entity.type === "asteroid") {
        this.#currentAsteroids--;
      }

      if (entity instanceof Ship && entity.ai instanceof PirateAI) {
        this.#currentPirates--;
      }
    }

    this.#removedEntities.clear();

    this.#forEachSimulatedEntity((entity) => {
      entity.postUpdate(this, delta);
    });
  }

  #getEntityUpdateMetric(entity: BaseEntity) {
    switch (entity.type) {
      case "asteroid":
        return "entityUpdateAsteroidMs" as const;
      case "ship":
        return "entityUpdateShipMs" as const;
      case "bullet":
        return "entityUpdateBulletMs" as const;
      case "exp":
        return "entityUpdateExpMs" as const;
      default:
        return "entityUpdateOtherMs" as const;
    }
  }

  #refillPirates() {
    if (
      !this.#engine ||
      this.#engine.tick % this.#piratesRefillInterval !== 0
    ) {
      return;
    }

    if (this.#currentPirates >= this.#maxPirates) {
      if (this.engine.debug.pirates) {
        console.log("max pirates reached, current: ", this.#currentPirates);
      }
      return;
    }

    this.#spawnPirate();

    if (this.engine.debug.pirates) {
      console.log("refilled pirates");
      console.log(`current pirates: ${this.#currentPirates}`);
    }
  }

  #refillAsteroids() {
    if (
      !this.#engine ||
      this.#engine.tick % this.#asteroidsRefillInterval !== 0
    ) {
      return;
    }

    if (this.#currentAsteroids >= this.#maxAsteroids) {
      if (this.engine.debug.asteroids) {
        console.log("max asteroids reached, current: ", this.#currentAsteroids);
      }
      return;
    }

    const batchCount =
      Math.floor(
        Math.random() *
          (this.#asteroidsMaxBatchCount - this.#asteroidsMinBatchCount + 1)
      ) + this.#asteroidsMinBatchCount;
    for (let i = 0; i < batchCount; i++) {
      this.#spawnAsteroid({
        beyondBorder: true,
        velocity: this.#getAsteroidSpawnVelocity(),
      });
    }

    if (this.engine.debug.asteroids) {
      console.log(`refilled ${batchCount} asteroids`);
      console.log(`current asteroids: ${this.#currentAsteroids}`);
    }
  }

  /**
   * Query the world for entities in near chunks.
   *
   * This will return all entities in area wchich are not marked as removed.
   * */
  query(pos: Vector2, radius: number, includeRemoved: boolean = false) {
    const entitiesArray = this.#grid.query(pos, radius, false, includeRemoved);
    return this.#createAccessor(entitiesArray, pos, radius);
  }

  /**
   * Query the world for entities in near chunks.
   *
   * This will return all entities in area wchich are marked as changed,
   * including removed entities.
   * */
  queryChanged(pos: Vector2, radius: number) {
    const entitiesArray = this.#grid.query(pos, radius, true);
    return this.#createAccessor(entitiesArray, pos, radius);
  }

  #createAccessor(entities: BaseEntity[], pos: Vector2, radius: number) {
    const createAccessor = (entities: BaseEntity[]) => ({
      set: () => new Set(entities),
      map: () => new Map(entities.map((entity) => [entity.id, entity])),
      array: () => entities,
    });

    return {
      /** Query the world for entities within a given radius of a position.
       *
       * This is more precise than the regular query, but also more expensive. */
      precise: () => {
        return createAccessor(
          entities.filter((entity) => {
            const dx = entity.x - pos.x;
            const dy = entity.y - pos.y;
            return dx ** 2 + dy ** 2 <= radius ** 2;
          })
        );
      },
      ...createAccessor(entities),
    };
  }

  broadcast(event: SerializableEvent) {
    const entiyId =
      "entityId" in event.payload ? event.payload.entityId : undefined;

    const data = this.engine.measurePerformance("networkSerializeMs", () =>
      event.serialize()
    );
    for (const player of this.engine.network.players) {
      if (entiyId && !player.lastSeenEntityIds.has(entiyId)) {
        continue;
      }

      this.engine.measurePerformance("wsSendMs", () => {
        player.ws.send(data);
      });
    }
  }

  clear() {
    this.#engine = null;
    this.#entities.clear();
    this.#nonAsteroidEntities.clear();
    this.#grid.clear();
    this.#chunkActivity.clear();
    this.#eventsByTick.clear();
    this.#nextTickEventIndex = 0;
    this.#currentAsteroids = 0;
    this.#currentPirates = 0;
  }

  #forEachSimulatedEntity(fn: (entity: BaseEntity) => void) {
    for (const entity of this.#nonAsteroidEntities) {
      fn(entity);
    }

    for (const asteroid of this.#chunkActivity.getActiveAsteroids()) {
      fn(asteroid);
    }
  }
}
