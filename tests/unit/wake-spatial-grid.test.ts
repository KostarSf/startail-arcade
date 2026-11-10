import { expect, test } from "bun:test";
import { Asteroid } from "../../src/server/engine/entities/asteroid";
import { WakeSpatialGrid } from "../../src/server/engine/world/wake-spatial-grid";
import { Random } from "../../src/shared/math/random";

test("wake broad phase contains every overlapping pair, including negative cells and large bodies", () => {
  const random = new Random(42);
  const asteroids = Array.from(
    { length: 400 },
    () =>
      new Asteroid({
        x: random.floating(-1000, 1000),
        y: random.floating(-1000, 1000),
        radius: random.floating(1, 130),
      }),
  );
  for (const cellSize of [32, 64, 128, 500]) {
    const grid = new WakeSpatialGrid(asteroids, cellSize);
    // Repeat after arbitrary movements to exercise index updates across cells.
    for (let pass = 0; pass < 2; pass++) {
      for (const asteroid of asteroids) {
        const actual = new Set(grid.query(asteroid));
        for (const other of asteroids) {
          if (
            Math.hypot(asteroid.x - other.x, asteroid.y - other.y) <
            asteroid.radius + other.radius
          ) {
            expect(actual.has(other)).toBeTrue();
          }
        }
      }
      for (const asteroid of asteroids) {
        asteroid.x += random.floating(-500, 500);
        asteroid.y += random.floating(-500, 500);
        grid.update(asteroid);
      }
    }
  }
});

test("wake grid excludes removed asteroids and drops moved entries from old cells", () => {
  const a = new Asteroid({ x: 0, y: 0, radius: 18 });
  const b = new Asteroid({ x: 5, y: 0, radius: 18 });
  const grid = new WakeSpatialGrid([a, b]);
  expect(grid.query(a)).toContain(b);
  b.x = 1000;
  grid.update(b);
  expect(grid.query(a)).not.toContain(b);
  b.remove();
  expect(new WakeSpatialGrid([a, b]).query(b)).not.toContain(b);
});
