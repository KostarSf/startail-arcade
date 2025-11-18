import { BaseEntity, type IBaseEntity } from "./base-entity";

export interface IAsteroid extends IBaseEntity {
  size: number;
}

export class Asteroid extends BaseEntity {
  size: number;

  constructor(asteroid: Partial<IAsteroid>) {
    super(asteroid);
    this.type = "asteroid";
    this.size = asteroid.size ?? 10;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      size: this.size,
    };
  }
}
