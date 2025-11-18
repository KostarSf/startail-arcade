/** Linearly interpolates between two values */
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Clamps a value between a minimum and maximum */
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}
