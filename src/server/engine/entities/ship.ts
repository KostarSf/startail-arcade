import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";

export interface IShip extends IBaseEntity {
  thrust: boolean;
}

export class Ship extends BaseEntity {
  thrust = false;

  #firing = false;

  constructor(ship: Partial<IShip>) {
    super(ship);
    this.thrust = ship.thrust ?? false;
  }

  override update(delta: number) {
    super.update(delta);

    if (this.thrust) {
      const ACCELERATION = 50;
      const ax = Math.cos(this.angle) * ACCELERATION * delta;
      const ay = Math.sin(this.angle) * ACCELERATION * delta;
      this.addVelocity(ax, ay);
    } else {
      const DECELERATION = 10;
      // reduce velocity by DECELERATION * delta
      this.addVelocity(
        -this.vx * DECELERATION * delta,
        -this.vy * DECELERATION * delta
      );
      // if velocity is less than 0.1, set it to 0
      if (Math.abs(this.vx) < 0.1) this.vx = 0;
      if (Math.abs(this.vy) < 0.1) this.vy = 0;
    }

    if (this.#firing) {
      this.#firing = false;
      const bullet = new Bullet({
        x: this.x + Math.cos(this.angle) * 10,
        y: this.y + Math.sin(this.angle) * 10,
        angle: this.angle,
        vx: Math.cos(this.angle) * 100,
        vy: Math.sin(this.angle) * 100,
      });
      this.world.spawn(bullet);
    }
  }

  fire() {
    this.#firing = true;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      type: "ship",
      thrust: this.thrust,
    };
  }
}
