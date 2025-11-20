import type { Vector2 } from "@/shared/math/vector";
import type { Engine } from "../engine";
import { Asteroid } from "../entities/asteroid";
import type { BaseEntity } from "../entities/base-entity";
import { CollisionResolver } from "./collision-resolver";
import { UniformGrid } from "./uniform-grid";

export class World {
  #entities = new Map<string, BaseEntity>();
  #grid = new UniformGrid();
  #collisionResolver = new CollisionResolver();

  #borderRadius = 2000;

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

    const ASTEROID_COUNT = 50;
    const ASTEROID_VELOCITY = 50;
    const ASTEROID_ANGLE_VELOCITY = Math.PI * 0.5;

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const radius = Math.floor(Math.random() * 40 + 10);
      const x = Math.random() * this.#borderRadius * 2 - this.#borderRadius;
      const y = Math.random() * this.#borderRadius * 2 - this.#borderRadius;
      const angle = Math.random() * 2 * Math.PI - Math.PI;
      const vx = Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2;
      const vy = Math.random() * ASTEROID_VELOCITY - ASTEROID_VELOCITY / 2;
      const va =
        Math.random() * ASTEROID_ANGLE_VELOCITY - ASTEROID_ANGLE_VELOCITY / 2;
      const asteroid = new Asteroid({ x, y, angle, vx, vy, va, radius });
      this.spawn(asteroid);
    }
  }

  update(delta: number) {
    for (const entity of this.#entities.values()) {
      if (!entity.initialized) {
        entity.initialize(this);
      }

      entity.update(this, delta);

      if (entity.removed) {
        this.#collisionResolver.removeEntity(this, entity);
        entity.onRemove(this);
        this.#entities.delete(entity.id);
        this.#grid.remove(entity);
      } else {
        this.#grid.update(entity);
      }
    }

    this.#collisionResolver.update(this);
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

  clear() {
    this.#engine = null;
    this.#entities.clear();
    this.#grid.clear();
  }
}
