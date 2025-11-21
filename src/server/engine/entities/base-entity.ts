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

  preUpdate(world: World, delta: number) {
    this.#prevPos = this.position;
  }

  update(world: World, delta: number) {
    integrateMotion(this, delta);

    if (this.x < -world.borderRadius) {
      this.x += world.borderRadius * 2;
    }
    if (this.x > world.borderRadius) {
      this.x -= world.borderRadius * 2;
    }
    if (this.y < -world.borderRadius) {
      this.y += world.borderRadius * 2;
    }
    if (this.y > world.borderRadius) {
      this.y -= world.borderRadius * 2;
    }
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
  }

  onRemove(world: World) {
    if (world.engine.debug.lifecycle) {
      console.log(`entity removed: ${this.name}`);
    }
  }

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  setVelocity(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
  }

  addPosition(x: number, y: number) {
    this.x += x;
    this.y += y;
  }

  addVelocity(vx: number, vy: number) {
    this.vx += vx;
    this.vy += vy;
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
