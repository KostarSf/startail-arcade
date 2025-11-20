import { BaseEntity, type IBaseEntity } from "./base-entity";

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
}
