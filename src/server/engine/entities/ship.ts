import { updateShipPhysics } from "@/shared/game/entities/ship";
import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";

export interface IShip extends IBaseEntity {
  thrust: boolean;
  lastInputSequence: number;
}

export class Ship extends BaseEntity {
  static #nextId = 1;

  thrust = false;
  lastInputSequence = -1;

  #firing = false;

  constructor(ship: Partial<IShip>) {
    if (!ship.name) {
      ship.name = `ship-${Ship.#nextId++}`;
    }

    ship.radius = 15;

    super(ship);
    this.type = "ship";
    this.thrust = ship.thrust ?? false;
    this.lastInputSequence = ship.lastInputSequence ?? -1;
  }

  override update(world: World, delta: number) {
    super.update(world, delta);

    const result = updateShipPhysics(this, {
      thrust: this.thrust,
      fire: this.#consumeFire(),
      delta,
    });

    if (result.bullet) {
      this.world.spawn(new Bullet(result.bullet));
    }
  }

  fire() {
    this.#firing = true;
  }

  #consumeFire() {
    const firing = this.#firing;
    this.#firing = false;
    return firing;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      thrust: this.thrust,
      lastInputSequence: this.lastInputSequence,
    };
  }
}
