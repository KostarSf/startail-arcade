import { Vector2 } from "./vector";

/**
 * Seeded random number generator using mulberry32 algorithm.
 * Provides deterministic random number generation with an optional seed.
 */
export class Random {
  private rng: () => number;

  constructor(seed?: number) {
    const actualSeed = seed ?? ((Math.random() * 1e9) | 0);
    this.rng = this.mulberry32(actualSeed);
  }

  /**
   * Mulberry32 PRNG algorithm
   */
  private mulberry32(seed: number): () => number {
    let a = seed | 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Returns a random integer between [min, max] (inclusive).
   */
  integer(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  /**
   * Returns a random floating point number between [min, max].
   */
  floating(min: number, max: number): number {
    return this.rng() * (max - min) + min;
  }

  /**
   * Returns a random boolean.
   * @param probability - Probability of returning true (0 to 1). Defaults to 0.5.
   */
  bool(probability: number = 0.5): boolean {
    return this.rng() < probability;
  }

  /**
   * Returns a random floating point number between [0, 1).
   */
  next(): number {
    return this.rng();
  }

  /**
   * Returns a random integer between 0 and Number.MAX_SAFE_INTEGER.
   */
  nextInt(): number {
    return Math.floor(this.rng() * Number.MAX_SAFE_INTEGER);
  }

  /**
   * Picks a random element from an array.
   */
  pickOne<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    return array[this.integer(0, array.length - 1)] as T;
  }

  /**
   * Picks multiple random elements from an array.
   * @param array - Source array
   * @param count - Number of elements to pick
   * @param allowDuplicates - Whether to allow duplicate picks. Defaults to false.
   */
  pickSet<T>(array: T[], count: number, allowDuplicates: boolean = false): T[] {
    if (array.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    if (count <= 0) {
      return [];
    }

    if (allowDuplicates) {
      const result: T[] = [];
      for (let i = 0; i < count; i++) {
        result.push(this.pickOne(array));
      }
      return result;
    } else {
      if (count > array.length) {
        throw new Error(
          `Cannot pick ${count} unique elements from array of length ${array.length}`
        );
      }
      const indices = new Set<number>();
      while (indices.size < count) {
        indices.add(this.integer(0, array.length - 1));
      }
      return Array.from(indices).map((i) => array[i] as T);
    }
  }

  /**
   * Generates an array of random numbers between [min, max].
   */
  range(count: number, min: number, max: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.floating(min, max));
    }
    return result;
  }

  /**
   * Randomly shuffles an array using Fisher-Yates algorithm (mutates the array).
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.integer(0, i);
      [array[i], array[j]] = [array[j]!, array[i]!];
    }
    return array;
  }

  /**
   * Rolls a 4-sided die (returns 1-4).
   */
  d4(): number {
    return this.integer(1, 4);
  }

  /**
   * Rolls a 6-sided die (returns 1-6).
   */
  d6(): number {
    return this.integer(1, 6);
  }

  /**
   * Rolls an 8-sided die (returns 1-8).
   */
  d8(): number {
    return this.integer(1, 8);
  }

  /**
   * Rolls a 10-sided die (returns 1-10).
   */
  d10(): number {
    return this.integer(1, 10);
  }

  /**
   * Rolls a 12-sided die (returns 1-12).
   */
  d12(): number {
    return this.integer(1, 12);
  }

  /**
   * Rolls a 20-sided die (returns 1-20).
   */
  d20(): number {
    return this.integer(1, 20);
  }

  /**
   * Returns a random angle from -π to π.
   */
  angle(): number {
    return this.floating(-Math.PI, Math.PI);
  }

  /**
   * Returns a random angle in the specified range, handling -π/π wrap-around.
   * @param min - Minimum angle in radians
   * @param max - Maximum angle in radians
   */
  angleRange(min: number, max: number): number {
    // Normalize angles to [-π, π]
    const normalize = (angle: number): number => {
      angle = angle % (2 * Math.PI);
      if (angle > Math.PI) angle -= 2 * Math.PI;
      if (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    };

    const minNorm = normalize(min);
    const maxNorm = normalize(max);

    // If range doesn't cross the -π/π boundary
    if (minNorm <= maxNorm) {
      return this.floating(minNorm, maxNorm);
    }

    // Range crosses -π/π boundary (e.g., from 0.5 to -0.5)
    // We need to handle this as two ranges: [min, π] and [-π, max]
    const range1 = Math.PI - minNorm;
    const range2 = maxNorm - -Math.PI;
    const totalRange = range1 + range2;
    const random = this.rng() * totalRange;

    if (random < range1) {
      return minNorm + random;
    } else {
      return -Math.PI + (random - range1);
    }
  }

  /**
   * Returns a random point in a circle area.
   * @param pos - Center position
   * @param radius - Circle radius
   */
  area(pos: Vector2, radius: number): Vector2;
  /**
   * Returns a random point in an ellipse area.
   * @param pos - Center position
   * @param xRadius - Horizontal radius
   * @param yRadius - Vertical radius
   */
  area(pos: Vector2, xRadius: number, yRadius: number): Vector2;
  area(pos: Vector2, radiusOrX: number, yRadius?: number): Vector2 {
    if (yRadius === undefined) {
      // Circle: use uniform distribution in circle
      const angle = this.floating(0, 2 * Math.PI);
      const r = radiusOrX * Math.sqrt(this.rng()); // sqrt for uniform distribution
      return pos.add(new Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    } else {
      // Ellipse: use uniform distribution in ellipse
      const angle = this.floating(0, 2 * Math.PI);
      const r = Math.sqrt(this.rng()); // sqrt for uniform distribution
      return pos.add(
        new Vector2(
          Math.cos(angle) * radiusOrX * r,
          Math.sin(angle) * yRadius * r
        )
      );
    }
  }

  /**
   * Returns a random point in a square area.
   * @param pos - Center position
   * @param radius - Half-width/height of the square
   */
  squareArea(pos: Vector2, radius: number): Vector2;
  /**
   * Returns a random point in a rectangular area.
   * @param pos - Center position
   * @param width - Half-width of the rectangle
   * @param height - Half-height of the rectangle
   */
  squareArea(pos: Vector2, width: number, height: number): Vector2;
  squareArea(pos: Vector2, radiusOrWidth: number, height?: number): Vector2 {
    if (height === undefined) {
      // Square
      const x = this.floating(-radiusOrWidth, radiusOrWidth);
      const y = this.floating(-radiusOrWidth, radiusOrWidth);
      return pos.add(new Vector2(x, y));
    } else {
      // Rectangle
      const x = this.floating(-radiusOrWidth, radiusOrWidth);
      const y = this.floating(-height, height);
      return pos.add(new Vector2(x, y));
    }
  }
}
