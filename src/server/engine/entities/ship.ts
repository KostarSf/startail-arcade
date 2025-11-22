import { updateShipPhysics } from "@/shared/game/entities/ship";
import type { World } from "../world/world";
import { Asteroid } from "./asteroid";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { LivingEntity } from "./living-entity";

export interface IShip extends IBaseEntity {
  thrust: boolean;
  lastInputSequence: number;
  health: number;
  maxHealth: number;
}

export class Ship extends LivingEntity {
  override type = "ship" as const;

  static #nextId = 1;

  thrust = false;

  lastInputSequence = -1;

  #firing = false;
  #compensatedFire = false;

  #energy = 100;
  #maxEnergy = 100;
  /** per second */
  #energyRechargeRate = 20;

  constructor(ship: Partial<IShip>) {
    if (!ship.name) {
      ship.name = `ship-${Ship.#nextId++}`;
    }

    ship.radius = 13;

    super(ship);
    this.thrust = ship.thrust ?? false;
    this.lastInputSequence = ship.lastInputSequence ?? -1;
    this.maxHealth = ship.maxHealth ?? 100;
    this.health = ship.health ?? this.maxHealth;
  }

  protected override onDamage(
    world: World,
    amount: number,
    source?: BaseEntity
  ): number {
    if (source && source instanceof Bullet) {
      const relativeVelocity = source.velocity.sub(this.velocity);
      this.velocity = this.velocity.add(relativeVelocity.mul(0.15));
      this.markChanged();
    }

    return amount;
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    const oldVX = this.vx;
    const oldVY = this.vy;
    const oldAngle = this.angle;

    const result = updateShipPhysics(this, {
      thrust: this.thrust,
      ...this.#consumeFire(),
      delta,
    });

    // NOTE: This is a hack to force the client to update the ship state.
    // without this, ships lag behind the server state.
    // TODO: Remove this once we have a proper way to update the ship state.
    if (
      Math.abs(oldVX - this.vx) > 0.05 ||
      Math.abs(oldVY - this.vy) > 0.05 ||
      Math.abs(oldAngle - this.angle) > 0.05
    ) {
      this.markChanged();
    }

    if (result.bullet) {
      result.bullet.ownerId = this.id;
      const bullet = new Bullet(result.bullet);
      this.world.spawn(bullet);

      const direction = bullet.velocity.sub(this.velocity).normalize();
      this.velocity = this.velocity.sub(direction.mul(5));
    }

    this.#rechargeEnergy(delta);
  }

  #rechargeEnergy(delta: number) {
    const oldEnergy = this.#energy;

    if (this.#energy < this.#maxEnergy) {
      let multiplier = 1;
      if (this.#energy < this.#maxEnergy * 0.7) multiplier = 0.5;
      if (this.#energy < this.#maxEnergy * 0.3) multiplier = 0.25;

      this.#energy += Math.ceil(this.#energyRechargeRate * multiplier * delta);
      this.#energy = Math.min(this.#energy, this.#maxEnergy);
    }

    if (Math.abs(oldEnergy - this.#energy) > 0.1) {
      // NOTE: It might be better to send only to the local client, not to all,
      // because other players don't see enemy energy.
      this.markChanged();
    }
  }

  /**
   * Fire a bullet.
   * @param compensateMotion - If true, compensate for the ship's motion when firing.
   */
  fire(compensateMotion = false) {
    const consumpsion = 25;
    if (this.#energy < consumpsion) return;

    this.#energy -= consumpsion;
    this.#firing = true;
    this.#compensatedFire = compensateMotion;
  }

  #consumeFire() {
    if (!this.#firing) {
      return null;
    }

    this.markChanged();

    const firing = {
      fire: this.#firing,
      compensatedFire: this.#firing ? this.#compensatedFire : false,
    };

    this.#firing = false;
    this.#compensatedFire = false;

    return firing;
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Ship || other instanceof Asteroid) {
      this.markChanged();
      const relativeSpeed = other.velocity.sub(this.velocity).length();
      const damage = Math.floor(Math.max(relativeSpeed - 150, 0) * 0.5);
      if (damage > 0) {
        this.takeDamage(world, damage, other);
      }
    }
  }

  override onCollision(world: World, other: BaseEntity): void {
    if (other instanceof Asteroid || other instanceof Ship) {
      this.markChanged();
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
      health: this.health,
      maxHealth: this.maxHealth,
      thrust: this.thrust,
      lastInputSequence: this.lastInputSequence,
      energy: this.#energy,
      maxEnergy: this.#maxEnergy,
    };
  }
}
