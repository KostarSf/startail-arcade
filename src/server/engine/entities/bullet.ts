import { TPS } from "../constants";
import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { LivingEntity } from "./living-entity";

export interface IBullet extends IBaseEntity {
  life: number;
  ownerId: string;
  damage: number;
}

export class Bullet extends BaseEntity {
  override type = "bullet" as const;

  static #nextId = 1;

  static lifeSpan = TPS * 5; // 4 seconds
  life: number;

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

    super(bullet);
    this.#ownerId = bullet.ownerId ?? null;
    this.life = bullet.life ?? Bullet.lifeSpan;
    this.damage = bullet.damage ?? 25;
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

    this.life -= 1;
    if (this.life <= 0) {
      this.remove();
      return;
    }
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other === this.#owner) return;

    if (other instanceof LivingEntity) {
      other.takeDamage(world, this.damage, this);
      this.remove();
    }
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ownerId: this.#ownerId ?? undefined,
      life: this.life,
      damage: this.damage,
    };
  }
}
