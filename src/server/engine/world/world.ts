import type { BaseEntity } from "../entities/base-entity";

export class World {
  #entities = new Map<string, BaseEntity>();

  get entities() {
    return Array.from(this.#entities.values());
  }

  spawn(entity: BaseEntity) {
    if (entity.initialized) {
      throw new Error("Entity already initialized");
    }
    this.#entities.set(entity.id, entity);
  }

  find(id: string) {
    return this.#entities.get(id);
  }

  update(delta: number) {
    for (const entity of this.#entities.values()) {
      if (!entity.initialized) {
        entity.initialize(this);
      }

      entity.update(delta);

      if (entity.removed) {
        this.#entities.delete(entity.id);
      }
    }
  }

  clear() {
    this.#entities.clear();
  }
}
