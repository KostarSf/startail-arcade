import type { Vector2 } from "@/shared/math/vector";
import type { SerializableEvent } from "@/shared/network/utils";
import { TPS } from "../constants";
import type { Engine } from "../engine";
import { Asteroid } from "../entities/asteroid";
import type { BaseEntity } from "../entities/base-entity";
import { CollisionResolver } from "./collision-resolver";
import { UniformGrid } from "./uniform-grid";

export class World {
  #entities = new Map<string, BaseEntity>();
  #grid = new UniformGrid();
  #collisionResolver = new CollisionResolver();

  #borderRadius = 5000;

  #maxAsteroids = 1000;
  #currentAsteroids = 0;

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

  spawn(entity: BaseEntity) {
    if (entity.initialized) {
      throw new Error("Entity already initialized");
    }
    this.#entities.set(entity.id, entity);
    this.#grid.update(entity);
  }

  find(id: string) {
    return this.#entities.get(id);
  }

  initialize(engine: Engine) {
    this.#engine = engine;

    for (let i = this.#currentAsteroids; i < this.#maxAsteroids; i++) {
      this.#spawnAsteroid();
    }
  }

  #spawnAsteroid(args?: { beyondBorder?: boolean }) {
    const ASTEROID_VELOCITY = 50;
    const ASTEROID_ANGLE_VELOCITY = Math.PI * 0.5;

    const [radius, health, velocityMultiplier] = [
      [8, 20, 4],
      [12, 50, 1],
      [18, 100, 0.4],
    ].at(Math.floor(Math.random() * 3)) as [number, number, number];

    let x = Math.random() * this.#borderRadius * 2 - this.#borderRadius;
    let y = Math.random() * this.#borderRadius * 2 - this.#borderRadius;

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
      x = Math.random() * this.#borderRadius * 2 - this.#borderRadius;
      y = Math.random() * this.#borderRadius * 2 - this.#borderRadius;
    }

    const angle = Math.random() * 2 * Math.PI - Math.PI;
    const vx =
      (Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2) *
      velocityMultiplier;
    const vy =
      (Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2) *
      velocityMultiplier;
    const va =
      Math.random() * ASTEROID_ANGLE_VELOCITY - ASTEROID_ANGLE_VELOCITY / 2;
    const asteroid = new Asteroid({
      x,
      y,
      angle,
      vx: vx + Math.random() * 10 - 3,
      vy: vy + Math.random() * 20 - 6,
      va,
      radius,
      maxHealth: health,
    });
    this.spawn(asteroid);

    this.#currentAsteroids++;
  }

  update(delta: number) {
    this.#refillAsteroids();

    for (const entity of this.#entities.values()) {
      if (!entity.initialized) {
        entity.initialize(this);
      }

      entity.preUpdate(this, delta);
    }

    for (const entity of this.#entities.values()) {
      entity.update(this, delta);

      if (entity.removed) {
        this.#collisionResolver.removeEntity(this, entity);
        entity.onRemove(this);
        this.#entities.delete(entity.id);
        this.#grid.remove(entity);

        if (entity.type === "asteroid") {
          this.#currentAsteroids--;
        }
      } else {
        this.#grid.update(entity);
      }
    }

    this.#collisionResolver.update(this);
  }

  #ticksAfterLastRefill = 0;
  #refillInterval = TPS * 5;
  #minBatchCount = 10;
  #maxBatchCount = 50;

  #refillAsteroids() {
    if (this.#ticksAfterLastRefill < this.#refillInterval) {
      this.#ticksAfterLastRefill++;
      return;
    }

    this.#ticksAfterLastRefill = 0;

    if (this.#currentAsteroids >= this.#maxAsteroids) {
      if (this.engine.debug.asteroids) {
        console.log("max asteroids reached, current: ", this.#currentAsteroids);
      }
      return;
    }

    const batchCount =
      Math.floor(
        Math.random() * (this.#maxBatchCount - this.#minBatchCount + 1)
      ) + this.#minBatchCount;
    for (let i = 0; i < batchCount; i++) {
      this.#spawnAsteroid({ beyondBorder: true });
    }

    if (this.engine.debug.asteroids) {
      console.log(`refilled ${batchCount} asteroids`);
      console.log(`current asteroids: ${this.#currentAsteroids}`);
    }
  }

  /** Query the world for entities in near chunks. */
  query(pos: Vector2, radius: number) {
    const entitiesArray = this.#grid.query(pos, radius);

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
          entitiesArray.filter((entity) => {
            const dx = entity.x - pos.x;
            const dy = entity.y - pos.y;
            return dx ** 2 + dy ** 2 <= radius ** 2;
          })
        );
      },
      ...createAccessor(entitiesArray),
    };
  }

  broadcast(event: SerializableEvent) {
    const data = event.serialize();
    for (const player of this.engine.network.players) {
      player.ws.send(data);
    }
  }

  clear() {
    this.#engine = null;
    this.#entities.clear();
    this.#grid.clear();
    this.#currentAsteroids = 0;
  }
}
