import { TPS } from "../constants";
import { BaseEntity, type IBaseEntity } from "./base-entity";

export interface IBullet extends IBaseEntity {
  life: number;
  ownerId?: string;
}

export class Bullet extends BaseEntity {
  static lifeSpan = TPS * 5; // 4 seconds
  life: number;
  ownerId?: string;

  constructor(bullet: Partial<IBullet>) {
    super(bullet);
    this.type = "bullet";
    this.life = bullet.life ?? Bullet.lifeSpan;
    this.ownerId = bullet.ownerId;
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
      ownerId: this.ownerId,
    };
  }
}
