import type { BaseEntity } from "../entities/base-entity";
import type { World } from "./world";

export class CollisionResolver {
  #lastPairs = new Set<string>();
  #currentPairs = new Set<string>();

  update(world: World) {
    this.#currentPairs.clear();
    this.#detectCollisions(world);
    this.#processEvents(world);
    this.#lastPairs = new Set(this.#currentPairs);
  }

  #detectCollisions(world: World) {
    const allEntities = world.entities;

    for (const a of allEntities) {
      if (!a.radius) continue;

      const neighbors = world
        .query(a.position, a.radius * 2)
        .array();

      for (const b of neighbors) {
        if (a === b) continue;
        if (!b.radius) continue;

        if (this.#checkCircleCollision(a, b)) {
          const key = this.#pairKey(a, b);
          if (this.#currentPairs.has(key)) continue;
          this.#currentPairs.add(key);
        }
      }
    }
  }

  #pairKey(a: BaseEntity, b: BaseEntity) {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  #checkCircleCollision(a: BaseEntity, b: BaseEntity) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = (a.radius ?? 0) + (b.radius ?? 0);
    return dx ** 2 + dy ** 2 <= r ** 2;
  }

  #processEvents(world: World) {
    for (const key of this.#currentPairs) {
      const [aId, bId] = key.split(":");
      const a = world.find(aId ?? "");
      const b = world.find(bId ?? "");
      if (!a || !b) continue;

      if (!this.#lastPairs.has(key)) {
        a.onCollisionStart(world, b);
        b.onCollisionStart(world, a);
      }

      a.onCollision(world, b);
      b.onCollision(world, a);
    }

    for (const key of this.#lastPairs) {
      if (!this.#currentPairs.has(key)) {
        const [aId, bId] = key.split(":");
        const a = world.find(aId ?? "");
        const b = world.find(bId ?? "");
        if (!a || !b) continue;

        a.onCollisionEnd(world, b);
        b.onCollisionEnd(world, a);
      }
    }
  }

  removeEntity(world: World, entity: BaseEntity) {
    const toEnd = new Set<string>();

    for (const key of this.#currentPairs) {
      if (key.startsWith(entity.id + ":") || key.endsWith(":" + entity.id)) {
        toEnd.add(key);
      }
    }
    for (const key of this.#lastPairs) {
      if (key.startsWith(entity.id + ":") || key.endsWith(":" + entity.id)) {
        toEnd.add(key);
      }
    }

    for (const key of toEnd) {
      this.#currentPairs.delete(key);
      this.#lastPairs.delete(key);
    }

    for (const key of toEnd) {
      const [aId, bId] = key.split(":");
      const otherId = aId === entity.id ? bId : aId;
      const other = world.find(otherId ?? "");
      if (other) {
        entity.onCollisionEnd(world, other);
        other.onCollisionEnd(world, entity);
      }
    }
  }
}
