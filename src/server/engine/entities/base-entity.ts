import {
  integrateMotion,
  type BaseEntityState,
  type EntityType,
} from "@/shared/game/entities/base";
import { Vector2 } from "@/shared/math/vector";
import type { World } from "../world/world";

export type IBaseEntity = BaseEntityState & {
  continuousCollision?: boolean;
};

export abstract class BaseEntity {
  static #nextId = 1;

  abstract type: EntityType;
  id: string;
  name: string;

  x: number;
  y: number;
  /** Radians */
  angle: number;
  /** Pixels per second */
  vx: number;
  vy: number;
  /** Radians per second */
  va: number;

  /** Radius in pixels for collision detection */
  radius: number | undefined;

  continuousCollision: boolean;

  changed = true;

  #wasWarped = false;
  /** True if the entity was warped since the last update */
  get wasWarped() {
    return this.#wasWarped;
  }

  /** Previous position */
  #prevPos: Vector2 | null = null;
  get prevPos() {
    return this.#prevPos ?? this.position;
  }

  /** True if the entity has moved since the last update */
  get moved() {
    const dx = this.x - this.prevPos.x;
    const dy = this.y - this.prevPos.y;
    return dx ** 2 + dy ** 2 > 0.0001;
  }

  get position() {
    return new Vector2(this.x, this.y);
  }

  set position(position: Vector2) {
    this.x = position.x;
    this.y = position.y;
  }

  get velocity() {
    return new Vector2(this.vx, this.vy);
  }

  set velocity(velocity: Vector2) {
    this.vx = velocity.x;
    this.vy = velocity.y;
  }

  removed = false;

  #world: World | null = null;
  get world() {
    if (!this.#world) {
      throw new Error("Entity not initialized");
    }
    return this.#world;
  }

  get initialized() {
    return !!this.#world;
  }

  constructor(entity: Partial<Omit<IBaseEntity, "type">>) {
    this.name = entity.name ?? `entity-${BaseEntity.#nextId++}`;
    this.id = entity.id ?? crypto.randomUUID();
    this.x = entity.x ?? 0;
    this.y = entity.y ?? 0;
    this.#prevPos = new Vector2(this.x, this.y);
    this.angle = entity.angle ?? 0;
    this.vx = entity.vx ?? 0;
    this.vy = entity.vy ?? 0;
    this.va = entity.va ?? 0;
    this.radius = entity.radius ?? undefined;
    this.continuousCollision = entity.continuousCollision ?? false;
  }

  initialize(world: World) {
    this.#world = world;

    if (world.engine.debug.lifecycle) {
      console.log(`entity initialized: ${this.name}`);
    }
  }

  /** Mark the entity as changed.
   *
   * This will cause the entity to be included in the next client's state update.
   */
  markChanged() {
    this.changed = true;
  }

  preUpdate(world: World, delta: number) {
    this.#prevPos = this.position;
  }

  update(world: World, delta: number) {
    this.#wasWarped = false;

    integrateMotion(this, delta);

    const borderRadius = world.borderRadius;
    const wrapThreshold = 500; // Wrap if more than 500 units beyond border

    // Check X-axis wrapping
    const beyondLeftBorder = this.x < -borderRadius;
    const beyondRightBorder = this.x > borderRadius;
    const isBeyondBorderX = beyondLeftBorder || beyondRightBorder;

    if (isBeyondBorderX) {
      const distanceBeyondBorder = beyondLeftBorder
        ? -borderRadius - this.x
        : this.x - borderRadius;

      const isMovingTowardsEdge =
        (beyondLeftBorder && this.vx < 0) || (beyondRightBorder && this.vx > 0);

      // Wrap if more than threshold away OR if moving towards edge
      if (distanceBeyondBorder > wrapThreshold || isMovingTowardsEdge) {
        if (beyondLeftBorder) {
          this.x = borderRadius; // Wrap to right edge
        } else {
          this.x = -borderRadius; // Wrap to left edge
        }
        this.markChanged();
        this.#wasWarped = true;
      }
    }

    // Check Y-axis wrapping
    const beyondTopBorder = this.y < -borderRadius;
    const beyondBottomBorder = this.y > borderRadius;
    const isBeyondBorderY = beyondTopBorder || beyondBottomBorder;

    if (isBeyondBorderY) {
      const distanceBeyondBorder = beyondTopBorder
        ? -borderRadius - this.y
        : this.y - borderRadius;

      const isMovingTowardsEdge =
        (beyondTopBorder && this.vy < 0) || (beyondBottomBorder && this.vy > 0);

      // Wrap if more than threshold away OR if moving towards edge
      if (distanceBeyondBorder > wrapThreshold || isMovingTowardsEdge) {
        if (beyondTopBorder) {
          this.y = borderRadius; // Wrap to bottom edge
        } else {
          this.y = -borderRadius; // Wrap to top edge
        }
        this.markChanged();
        this.#wasWarped = true;
      }
    }
  }

  postUpdate(world: World, delta: number) {
    this.changed = false;
  }

  onCollision(world: World, other: BaseEntity) {
    // Override in subclasses
  }

  onCollisionStart(world: World, other: BaseEntity) {
    if (world.engine.debug.collisions) {
      console.log(`collision: ${this.name} <-> ${other.name} (started)`);
    }
  }

  onCollisionEnd(world: World, other: BaseEntity) {
    if (world.engine.debug.collisions) {
      console.log(`collision: ${this.name} <-> ${other.name} (ended)`);
    }
  }

  remove() {
    this.removed = true;
    this.markChanged();
  }

  onRemove(world: World) {
    if (world.engine.debug.lifecycle) {
      console.log(`entity removed: ${this.name}`);
    }
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      radius: this.radius,
      id: this.id,
      x: this.x,
      y: this.y,
      angle: this.angle,
      vx: this.vx,
      vy: this.vy,
      va: this.va,
    };
  }
}
