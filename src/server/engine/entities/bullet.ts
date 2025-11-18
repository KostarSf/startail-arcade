import { TPS } from "../constants";
import { BaseEntity, type IBaseEntity } from "./base-entity";

export interface IBullet extends IBaseEntity {
  life: number;
}

export class Bullet extends BaseEntity {
  static lifeSpan = TPS * 2; // 2 seconds
  life: number;

  constructor(bullet: Partial<IBullet>) {
    super(bullet);
    this.type = "bullet";
    this.life = bullet.life ?? Bullet.lifeSpan;
  }

  override update(delta: number) {
    super.update(delta);
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
