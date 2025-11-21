import { Vector2 } from "@/shared/math/vector";
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
      if (!a.radius || !a.initialized) continue;

      if (a.continuousCollision && a.moved) {
        this.#detectContinuousCollisions(world, a);
        continue;
      }

      this.#detectDiscreteCollisions(world, a);
    }
  }

  #detectDiscreteCollisions(world: World, a: BaseEntity) {
    const neighbors = world.query(a.position, (a.radius ?? 0) * 2).array();

    for (const b of neighbors) {
      if (a === b) continue;
      if (!b.radius || !b.initialized) continue;
      if (b.continuousCollision && b.moved) continue;

      if (this.#checkCircleCollision(a, b)) {
        const key = this.#pairKey(a, b);
        if (this.#currentPairs.has(key)) continue;
        this.#currentPairs.add(key);
      }
    }
  }

  #checkCircleCollision(a: BaseEntity, b: BaseEntity) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = (a.radius ?? 0) + (b.radius ?? 0);
    return dx ** 2 + dy ** 2 <= r ** 2;
  }

  #pairKey(a: BaseEntity, b: BaseEntity) {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  #detectContinuousCollisions(world: World, entity: BaseEntity) {
    const prevPos = entity.prevPos;
    const currPos = entity.position;
    const dx = currPos.x - prevPos.x;
    const dy = currPos.y - prevPos.y;
    const distance = Math.hypot(dx, dy);

    // If entity hasn't moved, fall back to regular collision detection
    if (distance < 0.001) {
      this.#detectDiscreteCollisions(world, entity);
      return;
    }

    const entityRadius = entity.radius ?? 0;
    const queryRadius = distance + entityRadius * 2;
    const midX = (prevPos.x + currPos.x) / 2;
    const midY = (prevPos.y + currPos.y) / 2;

    const candidates = world
      .query(new Vector2(midX, midY), queryRadius)
      .precise()
      .array();

    let earliestCollision: { entity: BaseEntity; t: number } | null = null;

    for (const other of candidates) {
      if (entity === other) continue;
      if (!other.radius || !other.initialized) continue;

      const collision = this.#sweptCircleCollision(
        prevPos.x,
        prevPos.y,
        currPos.x,
        currPos.y,
        entityRadius,
        other.x,
        other.y,
        other.radius ?? 0
      );

      if (
        collision &&
        (!earliestCollision || collision.t < earliestCollision.t)
      ) {
        earliestCollision = { entity: other, t: collision.t };
      }
    }

    // Handle the earliest collision
    if (earliestCollision && earliestCollision.t <= 1.0) {
      // Move entity to collision point
      const t = Math.max(0, earliestCollision.t - 0.001); // Slight offset to prevent overlap
      entity.setPosition(prevPos.x + dx * t, prevPos.y + dy * t);

      // Mark as colliding
      const key = this.#pairKey(entity, earliestCollision.entity);
      this.#currentPairs.add(key);
    } else {
      // No collision detected, perform regular collision check at current position
      this.#detectDiscreteCollisions(world, entity);
    }
  }

  #sweptCircleCollision(
    x1: number,
    y1: number, // Start position
    x2: number,
    y2: number, // End position
    r1: number, // Moving entity radius
    x3: number,
    y3: number, // Static entity position
    r2: number // Static entity radius
  ): { t: number } | null {
    // Vector from start to end
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.001) {
      // No movement, use regular circle-circle test
      const dist = Math.hypot(x1 - x3, y1 - y3);
      if (dist <= r1 + r2) {
        return { t: 0 };
      }
      return null;
    }

    // Vector from start to other entity
    const fx = x3 - x1;
    const fy = y3 - y1;

    // Expand the static circle to include the moving circle
    const expandedRadius = r1 + r2;

    // Solve quadratic equation: |start + t * direction - other| = expandedRadius
    // Which expands to: at² + bt + c = 0
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - expandedRadius * expandedRadius;

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      return null; // No collision
    }

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    // Return the earliest valid collision time in [0, 1]
    let collisionT: number | null = null;
    if (t1 >= 0 && t1 <= 1) {
      collisionT = t1;
    }
    if (t2 >= 0 && t2 <= 1 && (collisionT === null || t2 < collisionT)) {
      collisionT = t2;
    }

    return collisionT !== null ? { t: collisionT } : null;
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
