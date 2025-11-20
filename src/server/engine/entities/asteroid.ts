import { BaseEntity, type IBaseEntity } from "./base-entity";

export interface IAsteroid extends IBaseEntity {}

export class Asteroid extends BaseEntity {
  constructor(asteroid: Partial<IAsteroid>) {
    super(asteroid);
    this.type = "asteroid";
  }
}
