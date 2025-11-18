import { inverseLerp } from "../../../shared/math/utils";
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
    this.type = "ship";
    this.thrust = ship.thrust ?? false;
  }

  override update(delta: number) {
    super.update(delta);

    const speed = Math.sqrt(this.vx ** 2 + this.vy ** 2);
    let drift = 0;
    if (speed > 0.01) {
      const velocityAngle = Math.atan2(this.vy, this.vx);
      let angleDiff = Math.abs(this.angle - velocityAngle);
      // Нормализуем разницу в диапазон [0, π] с учетом цикличности углов
      angleDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
      drift = inverseLerp(angleDiff, 0, Math.PI);
    }

    if (this.thrust) {
      const MAX_SPEED = 250;
      const LIMIT_THRESHOLD = 150;
      const multiplier = 1 - inverseLerp(speed, LIMIT_THRESHOLD, MAX_SPEED);

      const START_BOOST = 5;
      const DRIFT_BOOST = 2;
      const ACCELERATION = 50;
      const velocity =
        ACCELERATION +
        ACCELERATION *
          (1 - inverseLerp(speed, 0, 100)) *
          START_BOOST *
          (1 - drift) +
        ACCELERATION * DRIFT_BOOST * drift;
      const ax = Math.cos(this.angle) * velocity * multiplier * delta;
      const ay = Math.sin(this.angle) * velocity * multiplier * delta;
      this.addVelocity(ax, ay);
    } else {
      const speed = Math.sqrt(this.vx ** 2 + this.vy ** 2);

      let DECELERATION = 0.1;
      if (speed < 1) DECELERATION = 1;
      else if (speed < 10) DECELERATION = 0.5;
      else if (speed < 100) DECELERATION = 0.1;
      else if (speed < 150) DECELERATION = 0.01;

      this.addVelocity(
        -this.vx * DECELERATION * delta,
        -this.vy * DECELERATION * delta
      );

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
      thrust: this.thrust,
    };
  }
}
