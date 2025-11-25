import type { World } from "../../world/world";
import type { BaseEntity } from "../base-entity";
import type { Ship } from "../ship";

export abstract class ShipAI {
  protected tickRate: number;

  #initialized = false;

  constructor(tickRate = 1) {
    this.tickRate = tickRate;
  }

  initialize(ship: Ship, world: World): void {}

  onShipDamage(world: World, amount: number, source?: BaseEntity): void {}

  update(ship: Ship, world: World, delta: number): void {
    if (world.engine.tick % this.tickRate === 0) {
      if (!this.#initialized) {
        this.initialize(ship, world);
        this.#initialized = true;
      }

      this.tick(ship, world, delta);
    }
  }

  abstract tick(ship: Ship, world: World, delta: number): void;
}
