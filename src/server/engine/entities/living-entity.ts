import { event } from "@/shared/network/utils";
import type { World } from "../world/world";
import { BaseEntity } from "./base-entity";

export interface Damageable {
  health: number;
  maxHealth: number;
  takeDamage(world: World, amount: number, source?: BaseEntity): void;
  isAlive: boolean;
}

export abstract class LivingEntity extends BaseEntity implements Damageable {
  health = 100;
  maxHealth = 100;

  get isAlive() {
    return this.health > 0 && !this.removed;
  }

  takeDamage(world: World, amount: number, source?: BaseEntity) {
    if (!this.isAlive) return;

    const damage = this.onDamage(world, amount, source);
    if (damage <= 0) return;

    this.health -= damage;

    world.broadcast(
      event({
        type: "entity:damage",
        entityId: this.id,
        amount: damage,
        x: this.position.x,
        y: this.position.y,
      })
    );

    if (!this.isAlive) {
      this.remove();
      world.broadcast(
        event({
          type: "entity:destroy",
          entityId: this.id,
          x: this.position.x,
          y: this.position.y,
        })
      );
    }
  }

  protected abstract onDamage(
    world: World,
    amount: number,
    source?: BaseEntity
  ): number;
}
