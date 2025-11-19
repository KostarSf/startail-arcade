import {
  integrateMotion,
  type BaseEntityState,
} from "@/shared/game/entities/base";
import { Vector2 } from "@/shared/math/vector";
import type { World } from "../world/world";

export type IBaseEntity = BaseEntityState;

export abstract class BaseEntity {
  type: string;
  id: string;

  x: number;
  y: number;
  /** Radians */
  angle: number;
  /** Pixels per second */
  vx: number;
  vy: number;
  /** Radians per second */
  va: number;

  get position() {
    return new Vector2(this.x, this.y);
  }

  get velocity() {
    return new Vector2(this.vx, this.vy);
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

  constructor(entity: Partial<IBaseEntity>) {
    this.type = entity.type ?? "entity";
    this.id = entity.id ?? crypto.randomUUID();
    this.x = entity.x ?? 0;
    this.y = entity.y ?? 0;
    this.angle = entity.angle ?? 0;
    this.vx = entity.vx ?? 0;
    this.vy = entity.vy ?? 0;
    this.va = entity.va ?? 0;
  }

  initialize(world: World) {
    this.#world = world;
  }

  update(delta: number) {
    integrateMotion(this, delta);
  }

  remove() {
    this.removed = true;
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
      type: this.type,
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
