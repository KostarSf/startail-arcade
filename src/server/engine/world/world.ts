import type { Vector2 } from "@/shared/math/vector";
import type { Engine } from "../engine";
import { Asteroid } from "../entities/asteroid";
import type { BaseEntity } from "../entities/base-entity";
import { UniformGrid } from "./uniform-grid";

export class World {
  #entities = new Map<string, BaseEntity>();
  #grid = new UniformGrid();

  #borderRadius = 2000;

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

      entity.update(delta);

      if (entity.x < -this.#borderRadius) {
        entity.x += this.#borderRadius * 2;
      }
      if (entity.x > this.#borderRadius) {
        entity.x -= this.#borderRadius * 2;
      }
      if (entity.y < -this.#borderRadius) {
        entity.y += this.#borderRadius * 2;
      }
      if (entity.y > this.#borderRadius) {
        entity.y -= this.#borderRadius * 2;
      }

      if (entity.removed) {
        this.#entities.delete(entity.id);
        this.#grid.remove(entity);
      } else {
        this.#grid.update(entity);
      }
    }
  }

  /** Query the world for entities within a given radius of a position. */
  query(pos: Vector2, radius: number) {
    const entitiesSet = this.#grid.query(pos, radius);
    return {
      set: () => entitiesSet,
      map: () =>
        new Map(entitiesSet.values().map((entity) => [entity.id, entity])),
      array: () => Array.from(entitiesSet.values()),
    };
  }

  clear() {
    this.#entities.clear();
    this.#grid.clear();
  }
}
