export class Vector2 {
  static ZERO = new Vector2(0, 0);
  static ONE = new Vector2(1, 1);
  static UP = new Vector2(0, 1);
  static DOWN = new Vector2(0, -1);
  static LEFT = new Vector2(-1, 0);
  static RIGHT = new Vector2(1, 0);

  x: number;
  y: number;

  constructor(x: number, y?: number) {
    this.x = x;
    this.y = y ?? x;
  }

  /** Adds a value to the vector. */
  add(value: number): Vector2;
  add(x: number, y: number): Vector2;
  add(vector: Vector2): Vector2;
  add(value1: number | Vector2, value2?: number): Vector2 {
    if (typeof value1 === "number") {
      const y = value2 ?? value1;
      return new Vector2(this.x + value1, this.y + y);
    }
    return new Vector2(this.x + value1.x, this.y + value1.y);
  }

  /** Subtracts a value from the vector. */
  sub(value: number): Vector2;
  sub(x: number, y: number): Vector2;
  sub(vector: Vector2): Vector2;
  sub(value1: number | Vector2, value2?: number): Vector2 {
    if (typeof value1 === "number") {
      const y = value2 ?? value1;
      return new Vector2(this.x - value1, this.y - y);
    }
    return new Vector2(this.x - value1.x, this.y - value1.y);
  }

  /** Multiplies the vector by a value. */
  mul(value: number): Vector2;
  mul(x: number, y: number): Vector2;
  mul(vector: Vector2): Vector2;
  mul(value1: number | Vector2, value2?: number): Vector2 {
    if (typeof value1 === "number") {
      const y = value2 ?? value1;
      return new Vector2(this.x * value1, this.y * y);
    }
    return new Vector2(this.x * value1.x, this.y * value1.y);
  }

  /** Divides the vector by a value. */
  div(value: number): Vector2;
  div(x: number, y: number): Vector2;
  div(vector: Vector2): Vector2;
  div(value1: number | Vector2, value2?: number): Vector2 {
    if (typeof value1 === "number") {
      const y = value2 ?? value1;
      return new Vector2(this.x / value1, this.y / y);
    }
    return new Vector2(this.x / value1.x, this.y / value1.y);
  }

  /** Negates the vector. */
  neg(): Vector2 {
    return new Vector2(-this.x, -this.y);
  }

  /** The square of the length of the vector. */
  squaredLength(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** The angle of the vector in radians. */
  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  /** The length of the vector. */
  length(): number {
    return Math.hypot(this.x, this.y);
  }

  /** Normalizes the vector to a length of 1. */
  normalize(): Vector2 {
    return this.div(this.length());
  }

  /** The dot product of the vector and another vector. (X-axis) */
  dot(vector: Vector2): number {
    return this.x * vector.x + this.y * vector.y;
  }

  /** The cross product of the vector and another vector. (Z-axis) */
  cross(vector: Vector2): number {
    return this.x * vector.y - this.y * vector.x;
  }

  /** Rotates the vector by a given angle in radians. */
  rotate(angle: number): Vector2 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos
    );
  }

  /** The distance between the vector and another vector. */
  distance(vector: Vector2): number {
    return Math.hypot(vector.x - this.x, vector.y - this.y);
  }

  /** Clones the vector. */
  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
}
