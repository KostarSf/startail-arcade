import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { Exp } from "./exp";
import { LivingEntity } from "./living-entity";
import { Ship } from "./ship";

export interface IAsteroid extends IBaseEntity {
  health: number;
  maxHealth: number;
}

export class Asteroid extends LivingEntity {
  override type = "asteroid" as const;

  static #nextId = 1;

  override radius: number;

  constructor(asteroid: Partial<IAsteroid>) {
    if (!asteroid.name) {
      asteroid.name = `asteroid-${Asteroid.#nextId++}`;
    }

    super(asteroid);

    this.maxHealth = asteroid.maxHealth ?? 100;
    this.health = asteroid.health ?? this.maxHealth;
    this.radius = asteroid.radius ?? 10;

    const expFactor = 1 + Math.random() * 0.5 - 0.2;
    this.earnablePoints = Math.floor(this.radius * 1.25 * expFactor);
  }

  protected override onDamage(
    world: World,
    amount: number,
    source?: BaseEntity
  ): number {
    if (source && source instanceof Bullet) {
      const relativeVelocity = source.velocity.sub(this.velocity);
      this.velocity = this.velocity.add(relativeVelocity.mul(0.04));
    }

    return amount;
  }

  protected override onDeath(world: World, source?: BaseEntity) {
    if (this.earnablePoints <= 0) return;

    if (source && (source.type === "ship" || source.type === "bullet")) {
      const relativeVelocity = source.velocity.mul(0.3).sub(this.velocity);
      Exp.spawn(
        world,
        this.position,
        relativeVelocity,
        Math.ceil(this.earnablePoints),
        (this.radius ?? 0) * 0.5
      );
    }
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
      this.markChanged();
      return;
    }
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Asteroid) {
      // Simple rigid body collision: exchange velocities based on mass (assume mass proportional to radius^2)
      const m1 = this.radius * this.radius;
      const m2 = other.radius * other.radius;

      // Relative position and velocity
      const normal = other.position.sub(this.position).normalize();
      const relativeVelocity = this.velocity.sub(other.velocity);
      const velAlongNormal = relativeVelocity.dot(normal);

      // Only resolve if moving toward each other
      if (velAlongNormal < 0) return;

      this.markChanged();

      // Coefficient of restitution (bounciness), 0 = inelastic, 1 = elastic
      const restitution = 0.7;

      // Impulse scalar
      const j = (-(1 + restitution) * velAlongNormal) / (1 / m1 + 1 / m2);

      // Apply impulse only to this asteroid
      const impulse = normal.mul(j);

      this.velocity = this.velocity.add(impulse.div(m1));

      // If collision is at high speed, take damage proportional to impact speed
      const impactSpeed = Math.abs(velAlongNormal);
      const DAMAGE_SPEED_THRESHOLD = 50; // minimum speed before damage is applied
      if (impactSpeed > DAMAGE_SPEED_THRESHOLD) {
        const damage = Math.floor((impactSpeed - DAMAGE_SPEED_THRESHOLD) * 0.3); // tune multiplier as needed
        if (damage > 0) {
          this.takeDamage(world, damage, other);
        }
      }
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
