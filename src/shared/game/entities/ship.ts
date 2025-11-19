import { inverseLerp } from "@/shared/math/utils";

import type { BaseEntityState } from "./base";

export interface ShipState extends BaseEntityState {
  thrust: boolean;
}

export interface ShipPhysicsOptions {
  thrust: boolean;
  fire: boolean;
  delta: number;
}

export interface BulletSpawnState {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
}

export interface ShipPhysicsResult {
  fired: boolean;
  bullet?: BulletSpawnState;
}

export const SHIP_CONSTANTS = {
  maxSpeed: 250,
  limitThreshold: 150,
  startBoost: 5,
  driftBoost: 2,
  acceleration: 50,
  bulletSpeed: 250,
  bulletOffset: 10,
};

export function updateShipPhysics(
  ship: ShipState,
  options: ShipPhysicsOptions
): ShipPhysicsResult {
  const speed = Math.sqrt(ship.vx ** 2 + ship.vy ** 2);
  let drift = 0;

  if (speed > 0.01) {
    const velocityAngle = Math.atan2(ship.vy, ship.vx);
    let angleDiff = Math.abs(ship.angle - velocityAngle);
    angleDiff = Math.min(angleDiff, Math.PI * 2 - angleDiff);
    drift = inverseLerp(angleDiff, 0, Math.PI);
  }

  if (options.thrust) {
    const multiplier =
      1 -
      inverseLerp(speed, SHIP_CONSTANTS.limitThreshold, SHIP_CONSTANTS.maxSpeed);

    const velocity =
      SHIP_CONSTANTS.acceleration +
      SHIP_CONSTANTS.acceleration *
        (1 - inverseLerp(speed, 0, 100)) *
        SHIP_CONSTANTS.startBoost *
        (1 - drift) +
      SHIP_CONSTANTS.acceleration * SHIP_CONSTANTS.driftBoost * drift;

    const ax = Math.cos(ship.angle) * velocity * multiplier * options.delta;
    const ay = Math.sin(ship.angle) * velocity * multiplier * options.delta;

    ship.vx += ax;
    ship.vy += ay;
  } else {
    let deceleration = 0.1;
    if (speed < 1) deceleration = 1;
    else if (speed < 10) deceleration = 0.5;
    else if (speed < 100) deceleration = 0.1;
    else if (speed < 150) deceleration = 0.01;

    ship.vx += -ship.vx * deceleration * options.delta;
    ship.vy += -ship.vy * deceleration * options.delta;

    if (Math.abs(ship.vx) < 0.1) ship.vx = 0;
    if (Math.abs(ship.vy) < 0.1) ship.vy = 0;
  }

  if (!options.fire) {
    return { fired: false };
  }

  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  const bullet: BulletSpawnState = {
    x: ship.x + cos * SHIP_CONSTANTS.bulletOffset,
    y: ship.y + sin * SHIP_CONSTANTS.bulletOffset,
    angle: ship.angle,
    vx: cos * SHIP_CONSTANTS.bulletSpeed + ship.vx,
    vy: sin * SHIP_CONSTANTS.bulletSpeed + ship.vy,
  };

  return { fired: true, bullet };
}
