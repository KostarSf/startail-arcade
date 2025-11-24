export type EntityType = "ship" | "asteroid" | "bullet" | "exp";

export interface BaseEntityState {
  name: string;
  type: EntityType;
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  va: number;
  radius?: number | undefined;
  linearDamping?: number | undefined;
  targetSpeed?: number | undefined;
  level?: number;
  health?: number;
  maxHealth?: number;
  energy?: number;
  maxEnergy?: number;
}

export interface GenericNetEntityState extends BaseEntityState {
  thrust?: boolean;
  lastInputSequence?: number;
  health?: number;
  maxHealth?: number;
  energy?: number;
  maxEnergy?: number;
}

export type MutableBaseEntityState = BaseEntityState & {
  [key: string]: unknown;
};

export const TWO_PI = Math.PI * 2;

export const normalizeAngle = (angle: number) =>
  ((angle + Math.PI) % TWO_PI) - Math.PI;

export function integrateMotion<T extends MutableBaseEntityState>(
  entity: Pick<
    T,
    | "x"
    | "y"
    | "angle"
    | "vx"
    | "vy"
    | "va"
    | "radius"
    | "linearDamping"
    | "targetSpeed"
  >,
  delta: number
) {
  if (entity.linearDamping && entity.targetSpeed) {
    const damping = entity.linearDamping;
    const k = Math.pow(damping, delta);

    const vx = entity.vx;
    const vy = entity.vy;

    const speed0 = Math.hypot(vx, vy);
    if (speed0 > 1e-8) {
      const dirX = vx / speed0;
      const dirY = vy / speed0;

      const target = entity.targetSpeed;

      const speed = target + (speed0 - target) * k;

      entity.vx = speed * dirX;
      entity.vy = speed * dirY;
    }
  }

  entity.x += entity.vx * delta;
  entity.y += entity.vy * delta;
  entity.angle += entity.va * delta;
  entity.angle = normalizeAngle(entity.angle);
}

export function integrateExpMagnetism<T extends MutableBaseEntityState>(
  exp: Pick<T, "x" | "y" | "vx" | "vy" | "radius">,
  ship: Pick<T, "x" | "y">,
  magnetRadius: number,
  deltaTime: number
) {
  const posXDiff = exp.x - ship.x;
  const posYDiff = exp.y - ship.y;
  const distance = Math.hypot(posXDiff, posYDiff);
  if (distance < magnetRadius) {
    const strength = Math.max(1 - distance / magnetRadius, 0);
    const directionX = posXDiff / distance;
    const directionY = posYDiff / distance;

    exp.vx -= directionX * strength * 600 * deltaTime;
    exp.vy -= directionY * strength * 600 * deltaTime;
  }
}
