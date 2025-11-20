import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { LivingEntity } from "./living-entity";
import { Ship } from "./ship";

export interface IAsteroid extends IBaseEntity {
  health: number;
  maxHealth: number;
}

export class Asteroid extends LivingEntity {
  override type = "asteroid" as const;

  static #nextId = 1;

  constructor(asteroid: Partial<IAsteroid>) {
    if (!asteroid.name) {
      asteroid.name = `asteroid-${Asteroid.#nextId++}`;
    }

    super(asteroid);

    this.maxHealth = asteroid.maxHealth ?? 100;
    this.health = asteroid.health ?? this.maxHealth;
  }

  protected override onDamage(
    world: World,
    amount: number,
    source?: BaseEntity
  ): number {
    return amount;
  }

  override onCollision(world: World, other: BaseEntity): void {
    if (other instanceof Ship || other instanceof Asteroid) {
      const direction = other.position.sub(this.position).normalize();
      const relativeSpeed = Math.max(
        Math.abs(other.velocity.sub(this.velocity).dot(direction)),
        2
      );
      this.velocity = this.velocity.add(
        direction.mul(relativeSpeed * 0.2).neg()
      );
      return;
    }
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      health: this.health,
      maxHealth: this.maxHealth,
    };
  }
}
