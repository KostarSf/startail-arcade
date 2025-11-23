import { Vector2 } from "@/shared/math/vector";
import type { World } from "../world/world";
import type { BaseEntity, IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";
import { LivingEntity } from "./living-entity";
import { Ship } from "./ship";

export interface IExp extends IBaseEntity {
  value: number;
}

export class Exp extends LivingEntity {
  override type = "exp" as const;

  static lifeSpan = 15; // 15 seconds

  override linearDamping = 0.4;
  override targetSpeed = 10;

  value: number;

  constructor(exp: Partial<IExp>) {
    super(exp);
    this.value = exp.value ?? 10;
    this.radius = exp.radius ?? 4;
    this.life = exp.life ?? Exp.lifeSpan;
  }

  override update(world: World, delta: number): void {
    super.update(world, delta);
  }

  override onDamage(world: World, amount: number, source?: BaseEntity): number {
    if (source) {
      const direction = source.velocity.sub(this.velocity).normalize();
      const relativeSpeed = Math.max(
        Math.abs(source.velocity.sub(this.velocity).dot(direction)),
        2
      );
      this.velocity = this.velocity.add(direction.mul(relativeSpeed * 0.2));
      this.markChanged();
    }

    return 0;
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Ship && !other.removed) {
      other.collectExp(this.value);
      this.remove();
      return;
    }

    if (other.removed || other instanceof Exp || other instanceof Bullet) {
      return;
    }

    // Calculate the normalized collision normal
    const normal = this.position.sub(other.position).normalize();
    // Calculate current relative velocity
    const relVel = this.velocity.sub(other.velocity);
    // Reflect the relative velocity vector across the normal
    const reflected = relVel.sub(normal.mul(2 * relVel.dot(normal)));
    // Optionally scale bounce effect (tweak 0.7 for elasticity)
    const bounceStrength = 0.7;
    this.velocity = reflected.mul(bounceStrength).add(other.velocity);
    this.markChanged();
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      value: this.value,
    };
  }

  static spawn(
    world: World,
    position: Vector2,
    velocity: Vector2,
    value: number,
    spawnRadius = 0
  ) {
    // Smart distribution using denominations: 5000, 1000, 500, 100, 50, 10, 5, 1
    const denominations = [5000, 1000, 500, 100, 50, 10, 5, 1];
    const values: number[] = [];
    let remaining = value;

    for (const denom of denominations) {
      const count = Math.floor(remaining / denom);
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          values.push(denom);
        }
        remaining -= count * denom;
      }
    }

    // If there's any remaining value (shouldn't happen with these denominations, but safety check)
    if (remaining > 0) {
      values.push(remaining);
    }

    const variance = velocity.length() * 0.04;
    const minSpeed = 20 + variance;
    const maxSpeed = 50 + variance;
    for (const value of values) {
      const startVelocity = Vector2.UP.rotate(
        Math.random() * 2 * Math.PI - Math.PI
      )
        .mul(Math.random() * (maxSpeed - minSpeed) + minSpeed)
        .add(velocity.mul(0.8));
      const exp = new Exp({
        x: position.x + Math.random() * spawnRadius * 2 - spawnRadius,
        y: position.y + Math.random() * spawnRadius * 2 - spawnRadius,
        angle: Math.random() * 2 * Math.PI - Math.PI,
        vx: startVelocity.x,
        vy: startVelocity.y,
        va: Math.random() * Math.PI - Math.PI * 0.5,
        life: Math.random() * Exp.lifeSpan * 0.2 + Exp.lifeSpan * 0.8,
        value,
      });
      world.spawn(exp);
    }
  }
}
