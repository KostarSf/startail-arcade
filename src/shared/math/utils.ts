/** Linearly interpolates between two values */
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Clamps a value between a minimum and maximum */
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Inverse linear interpolation - returns the interpolation parameter t (0 to 1)
 * for a value within the interval [min, max].
 * Returns 0 if value <= min, 1 if value >= max, and interpolates linearly between them.
 * This is the inverse operation of lerp.
 * @param value - The value to evaluate
 * @param min - Minimum edge of the interval
 * @param max - Maximum edge of the interval
 * @returns A value from 0 to 1, where 0 is at or below min and 1 is at or above max
 */
export function inverseLerp(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;

  // Linear interpolation between min and max
  return (value - min) / (max - min);
}

/**
 * Linearly interpolates between two angles, taking the shortest path.
 * Handles wrap-around at -PI/PI boundary correctly.
 * @param start - Starting angle in radians
 * @param end - Target angle in radians
 * @param t - Interpolation factor (0 to 1)
 * @returns Interpolated angle in radians
 */
export function angleLerp(start: number, end: number, t: number): number {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * t;
}
