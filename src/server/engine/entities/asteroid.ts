import type { World } from "../world/world";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Bullet } from "./bullet";

export interface IAsteroid extends IBaseEntity {}

export class Asteroid extends BaseEntity {
  static #nextId = 1;

  constructor(asteroid: Partial<IAsteroid>) {
    if (!asteroid.name) {
      asteroid.name = `asteroid-${Asteroid.#nextId++}`;
    }

    super(asteroid);
    this.type = "asteroid";
  }

  override onCollisionStart(world: World, other: BaseEntity): void {
    if (other instanceof Bullet) {
      this.remove();
      return;
    }
  }
}
