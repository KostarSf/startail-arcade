import { SHIP_CONSTANTS } from "@/shared/game/entities/ship";
import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { LivingEntity } from "./living-entity";

export interface IBullet extends IBaseEntity {
  ownerId: string;
  damage: number;
}

export class Bullet extends BaseEntity {
  override type = "bullet" as const;

  static #nextId = 1;

  static lifeSpan = 5; // 5 seconds

  #owner: BaseEntity | null = null;
  #ownerId: string | null = null;

  damage: number;

  get owner() {
    return this.#owner;
  }

  constructor(bullet: Partial<IBullet>) {
    if (!bullet.name) {
      bullet.name = `bullet-${Bullet.#nextId++}`;
    }
    bullet.radius = 3;
    bullet.continuousCollision = true;

    super(bullet);
    this.#ownerId = bullet.ownerId ?? null;
    this.life = Bullet.lifeSpan;
    this.damage = bullet.damage ?? 10;
  }

  override initialize(world: World) {
    super.initialize(world);
    const owner = world.find(this.#ownerId ?? "");
    if (owner) {
      this.#owner = owner;
    }

    if (world.engine.debug.lifecycle) {
      console.log(
        `bullet initialized: ${this.name} (owner: ${this.#owner?.name})`
      );
    }
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    this.angle = Math.atan2(this.vy, this.vx);
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other === this.#owner) return;

    if (other instanceof LivingEntity) {
      const speedFactor = Math.max(
        (this.velocity.sub(other.velocity).length() -
          SHIP_CONSTANTS.bulletSpeed -
          100) /
          1000,
        0
      );
      const additionalDamage = Math.floor(this.damage * speedFactor * 6);

      other.takeDamage(world, this.damage + additionalDamage, this);
      this.remove();
    }
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ownerId: this.#ownerId ?? undefined,
      damage: this.damage,
    };
  }
}
