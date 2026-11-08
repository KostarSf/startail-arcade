/** Canonical coordinate and shortest displacement on the square torus. */
export function wrapCoordinate(value: number, radius: number) {
  if (radius <= 0) return value;
  const size = radius * 2;
  return ((((value + radius) % size) + size) % size) - radius;
}

export function wrappedDelta(from: number, to: number, radius: number) {
  return wrapCoordinate(to - from, radius);
}

export function wrappedDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
) {
  return Math.hypot(wrappedDelta(a.x, b.x, radius), wrappedDelta(a.y, b.y, radius));
}
