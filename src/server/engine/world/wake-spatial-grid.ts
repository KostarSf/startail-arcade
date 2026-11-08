import type { Asteroid } from "../entities/asteroid";

/** Temporary fine grid: built only on wake, includes uninitialized asteroids. */
export class WakeSpatialGrid {
  #columns = new Map<number, Map<number, Set<Asteroid>>>();
  #locations = new Map<Asteroid, { x: number; y: number }>();
  maxRadius = 0;

  constructor(
    asteroids: Iterable<Asteroid>,
    private readonly cellSize = 64,
  ) {
    for (const asteroid of asteroids) {
      if (asteroid.removed) continue;
      this.maxRadius = Math.max(this.maxRadius, asteroid.radius);
      this.update(asteroid);
    }
  }

  update(asteroid: Asteroid) {
    const x = Math.floor(asteroid.x / this.cellSize);
    const y = Math.floor(asteroid.y / this.cellSize);
    const old = this.#locations.get(asteroid);
    if (old?.x === x && old.y === y) return;
    if (old) this.#columns.get(old.x)?.get(old.y)?.delete(asteroid);
    let column = this.#columns.get(x);
    if (!column) this.#columns.set(x, (column = new Map()));
    let cell = column.get(y);
    if (!cell) column.set(y, (cell = new Set()));
    cell.add(asteroid);
    this.#locations.set(asteroid, { x, y });
  }

  query(asteroid: Asteroid) {
    const radius = asteroid.radius + this.maxRadius;
    const minX = Math.floor((asteroid.x - radius) / this.cellSize);
    const maxX = Math.floor((asteroid.x + radius) / this.cellSize);
    const minY = Math.floor((asteroid.y - radius) / this.cellSize);
    const maxY = Math.floor((asteroid.y + radius) / this.cellSize);
    const result: Asteroid[] = [];
    for (let x = minX; x <= maxX; x++) {
      const column = this.#columns.get(x);
      if (!column) continue;
      for (let y = minY; y <= maxY; y++) {
        const cell = column.get(y);
        if (cell) for (const other of cell) result.push(other);
      }
    }
    return result;
  }
}
