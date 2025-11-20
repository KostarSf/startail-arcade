export interface BaseEntityState {
  name: string;
  type: string;
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  va: number;
  radius?: number | undefined;
}

export type MutableBaseEntityState = BaseEntityState & {
  [key: string]: unknown;
};

export const TWO_PI = Math.PI * 2;

export const normalizeAngle = (angle: number) =>
  ((angle + Math.PI) % TWO_PI) - Math.PI;

export function integrateMotion<T extends MutableBaseEntityState>(
  entity: Pick<T, "x" | "y" | "angle" | "vx" | "vy" | "va" | "radius">,
  delta: number
) {
  entity.x += entity.vx * delta;
  entity.y += entity.vy * delta;
  entity.angle += entity.va * delta;
  entity.angle = normalizeAngle(entity.angle);
}
