import { TPS } from "../constants";
import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";

export interface IBullet extends IBaseEntity {
  life: number;
}

export class Bullet extends BaseEntity {
  static #nextId = 1;

  static lifeSpan = TPS * 5; // 4 seconds
  life: number;

  constructor(bullet: Partial<IBullet>) {
    if (!bullet.name) {
      bullet.name = `bullet-${Bullet.#nextId++}`;
    }
    bullet.radius = 3;

    super(bullet);
    this.type = "bullet";
    this.life = bullet.life ?? Bullet.lifeSpan;
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    this.life -= 1;
    if (this.life <= 0) this.remove();
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      life: this.life,
    };
  }
}
