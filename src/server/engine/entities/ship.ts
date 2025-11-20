import { updateShipPhysics } from "@/shared/game/entities/ship";
import type { World } from "../world/world";
import { Asteroid } from "./asteroid";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";

export interface IShip extends IBaseEntity {
  thrust: boolean;
  lastInputSequence: number;
}

export class Ship extends BaseEntity {
  override type = "ship" as const;

  static #nextId = 1;

  thrust = false;
  lastInputSequence = -1;

  #firing = false;

  constructor(ship: Partial<IShip>) {
    if (!ship.name) {
      ship.name = `ship-${Ship.#nextId++}`;
    }

    ship.radius = 13;

    super(ship);
    this.thrust = ship.thrust ?? false;
    this.lastInputSequence = ship.lastInputSequence ?? -1;
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    const result = updateShipPhysics(this, {
      thrust: this.thrust,
      fire: this.#consumeFire(),
      delta,
    });

    if (result.bullet) {
      result.bullet.ownerId = this.id;
      this.world.spawn(new Bullet(result.bullet));
    }
  }

  fire() {
    this.#firing = true;
  }

  #consumeFire() {
    const firing = this.#firing;
    this.#firing = false;
    return firing;
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Bullet && other.owner !== this) {
      this.remove();
      return;
    }
  }

  override onCollision(world: World, other: BaseEntity): void {
    if (other instanceof Asteroid || other instanceof Ship) {
      const direction = other.position.sub(this.position).normalize();
      const relativeSpeed = Math.max(
        Math.abs(other.velocity.sub(this.velocity).dot(direction)),
        10
      );
      this.velocity = this.velocity.add(
        direction.mul(relativeSpeed * 0.5).neg()
      );
    }
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      thrust: this.thrust,
      lastInputSequence: this.lastInputSequence,
    };
  }
}
