import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { Ship } from "./ship";

export interface IAsteroid extends IBaseEntity {}

export class Asteroid extends BaseEntity {
  override type = "asteroid" as const;

  static #nextId = 1;

  constructor(asteroid: Partial<IAsteroid>) {
    if (!asteroid.name) {
      asteroid.name = `asteroid-${Asteroid.#nextId++}`;
    }

    super(asteroid);
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Bullet) {
      this.remove();
      return;
    }
  }

  override onCollision(world: World, other: BaseEntity): void {
    if (other instanceof Ship || other instanceof Asteroid) {
      const direction = other.position.sub(this.position).normalize();
      const relativeSpeed = Math.max(
        Math.abs(other.velocity.sub(this.velocity).dot(direction)),
        2
      );
      this.velocity = this.velocity.add(direction.mul(relativeSpeed * 0.2).neg());
      return;
    }
  }
}
