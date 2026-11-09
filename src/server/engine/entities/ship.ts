import { integrateExpMagnetism } from "@/shared/game/entities/base";
import {
  SHIP_CONSTANTS,
  updateShipPhysics,
  createBulletSpawnState,
  applyShotRecoil,
} from "@/shared/game/entities/ship";
import type { ServerPlayer } from "../server-network";
import type { World } from "../world/world";
import type { ShipAI } from "./ai/ship-ai";
import { Asteroid } from "./asteroid";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { Exp } from "./exp";
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

  #pendingShot: { angle: number; compensateMotion: boolean; shotId?: number } | null = null;
  #lastShotTick = -Infinity;

  captureRuntimeState() {
    return {
      body: this.toJSON(),
      energy: this.#energy,
      maxEnergy: this.maxEnergy,
      energyRechargeRate: this.energyRechargeRate,
      baseDamage: this.baseDamage,
      earnablePoints: this.earnablePoints,
      pendingShot: this.#pendingShot ? { ...this.#pendingShot } : null,
      lastShotTick: this.#lastShotTick,
    };
  }

  restoreRuntimeState(state: ReturnType<Ship["captureRuntimeState"]>) {
    this.#energy = state.energy;
    this.maxEnergy = state.maxEnergy;
    this.energyRechargeRate = state.energyRechargeRate;
    this.baseDamage = state.baseDamage;
    this.earnablePoints = state.earnablePoints;
    this.level = state.body.level;
    this.#pendingShot = state.pendingShot ? { ...state.pendingShot } : null;
    this.#lastShotTick = state.lastShotTick;
  }

  #energy = 100;
  maxEnergy = 100;
  /** per second */
  energyRechargeRate = 20;

  baseDamage = 10;

  player?: ServerPlayer;
  ai?: ShipAI;

  level?: number;

  override earnablePoints = 1;
  override radius = SHIP_CONSTANTS.radius;

  override canWakeChunks() {
    return true;
  }
  override getChunkWakeSources() {
    return [{ shape: "circle" as const, x: this.x, y: this.y, radius: 1000 }];
  }

  constructor(ship: Partial<IShip>) {
    if (!ship.name) {
      ship.name = `ship-${Ship.#nextId++}`;
    }

    super(ship);
    this.thrust = ship.thrust ?? false;
    this.lastInputSequence = ship.lastInputSequence ?? -1;
    this.maxHealth = ship.maxHealth ?? 100;
    this.health = ship.health ?? this.maxHealth;
  }

  protected override onDamage(world: World, amount: number, source?: BaseEntity): number {
    if (source && source instanceof Bullet) {
      const relativeVelocity = source.velocity.sub(this.velocity);
      this.velocity = this.velocity.add(relativeVelocity.mul(0.15));
      this.markChanged();
    }

    if (this.ai) {
      this.ai.onShipDamage(world, amount, source);
    }

    return amount;
  }

  protected override onDeath(world: World, source?: BaseEntity) {
    if (this.earnablePoints <= 0) return;

    const relativeVelocity = source ? source.velocity.mul(0.3).sub(this.velocity) : this.velocity;

    Exp.spawn(
      world,
      this.position,
      relativeVelocity,
      Math.ceil(this.earnablePoints),
      (this.radius ?? 0) * 0.7,
    );
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    if (this.ai) {
      this.ai.update(this, world, delta);
    }

    const oldVX = this.vx;
    const oldVY = this.vy;
    const oldAngle = this.angle;

    const spawnSpeed = Math.hypot(this.vx, this.vy);
    updateShipPhysics(this, {
      thrust: this.thrust,
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

    const shot = this.#pendingShot;
    if (shot) {
      this.#pendingShot = null;
      // Loading may defer an accepted shot; its eventual spawn also consumes this tick.
      this.#lastShotTick = world.engine.tick;
      const spawn = createBulletSpawnState(
        { x: this.x, y: this.y, vx: this.vx, vy: this.vy, angle: shot.angle },
        shot.compensateMotion,
        spawnSpeed,
      );
      const bullet = new Bullet({
        ...spawn,
        ownerId: this.id,
        damage: this.baseDamage,
        shotId: shot.shotId,
      });
      this.world.spawn(bullet);
      applyShotRecoil(this, spawn);
      if (shot.shotId !== undefined) {
        this.player?.pendingShotResults.push({
          shotId: shot.shotId,
          status: "accepted",
          bulletId: bullet.id,
        });
      }
      this.markChanged();
    }

    this.#rechargeEnergy(delta);

    this.#magnetizeExp(world, delta);
  }

  #magnetizeExp(world: World, delta: number) {
    const magnetRadius = this.radius * 15;

    const exp = world.query(this.position, magnetRadius);
    for (const entity of exp.precise().array()) {
      if (entity instanceof Exp) {
        integrateExpMagnetism(entity, this, magnetRadius, delta);
      }
    }
  }

  collectExp(value: number) {
    const earnablePoints = value / 25;
    this.earnablePoints += earnablePoints;
    this.heal(Math.ceil(earnablePoints));
    this.#energy = Math.min(this.#energy + Math.ceil(value * 0.25), this.maxEnergy);
    this.player?.addScore(value);
  }

  #rechargeEnergy(delta: number) {
    const oldEnergy = this.#energy;

    if (this.#energy < this.maxEnergy) {
      let multiplier = 1;
      if (this.#energy < this.maxEnergy * 0.7) multiplier = 0.5;
      if (this.#energy < this.maxEnergy * 0.3) multiplier = 0.25;

      this.#energy += Math.ceil(this.energyRechargeRate * multiplier * delta);
      this.#energy = Math.min(this.#energy, this.maxEnergy);
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
  fire(
    compensateMotion = false,
    shotId?: number,
    simTick = this.initialized ? this.world.engine.tick : -1,
  ) {
    // Keep the first valid shot and its aim. Never bank a burst across ticks.
    if (this.#pendingShot || this.#lastShotTick === simTick) return false;
    if (this.#energy < SHIP_CONSTANTS.shotEnergy) return false;
    this.#energy -= SHIP_CONSTANTS.shotEnergy;
    this.#lastShotTick = simTick;
    this.#pendingShot = { angle: this.angle, compensateMotion, shotId };
    this.markChanged();
    return true;
  }

  heal(amount: number) {
    if (this.health >= this.maxHealth || amount <= 0) return;

    this.health += amount;
    this.health = Math.min(this.health, this.maxHealth);

    this.world.emit({
      kind: "entity-damage",
      replication: "relevant",
      entityId: this.id,
      amount: -amount,
      x: this.position.x,
      y: this.position.y,
    });

    this.markChanged();
  }

  /**
   * Adjusts health and energy to preserve their percentages when max values increase.
   * Used during level-ups to maintain the same relative health/energy.
   */
  adjustStatsForLevelUp(oldMaxHealth: number, oldMaxEnergy: number) {
    // Preserve health percentage when maxHealth increases
    if (oldMaxHealth > 0) {
      const healthPercentage = this.health / oldMaxHealth;
      this.health = Math.min(Math.round(this.maxHealth * healthPercentage), this.maxHealth);
    }

    // Preserve energy percentage when maxEnergy increases
    if (oldMaxEnergy > 0) {
      const energyPercentage = this.#energy / oldMaxEnergy;
      this.#energy = Math.min(Math.round(this.maxEnergy * energyPercentage), this.maxEnergy);
    }

    this.markChanged();
  }

  override onRemove(world: World) {
    const shot = this.#pendingShot;
    if (shot) {
      if (shot.shotId !== undefined)
        this.player?.pendingShotResults.push({ shotId: shot.shotId, status: "rejected" });
    }
    this.#pendingShot = null;
    super.onRemove(world);
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
      const direction = world.displacement(this, other).normalize();
      const relativeSpeed = Math.max(
        Math.abs(other.velocity.sub(this.velocity).dot(direction)),
        10,
      );
      this.velocity = this.velocity.add(direction.mul(relativeSpeed * 0.5).neg());
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
      maxEnergy: this.maxEnergy,
      level: this.level,
    };
  }
}
