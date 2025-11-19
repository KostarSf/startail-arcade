import type { ComponentStoreHandle, EntityId, EntityManager } from "./entity-manager";

export type ComponentInitializer<T> = () => T;

export class ComponentStore<T> implements ComponentStoreHandle {
  #components = new Map<EntityId, T>();
  #defaults?: ComponentInitializer<T>;
  #entityManager: EntityManager;

  constructor(entityManager: EntityManager, defaults?: ComponentInitializer<T>) {
    this.#entityManager = entityManager;
    this.#defaults = defaults;
    this.#entityManager.registerStore(this);
  }

  set(entity: EntityId, value: T) {
    this.#components.set(entity, value);
  }

  ensure(entity: EntityId, initializer?: ComponentInitializer<T>) {
    if (!this.#components.has(entity)) {
      const value =
        initializer?.() ?? this.#defaults?.() ?? ({} as unknown as T);
      this.#components.set(entity, value);
      return value;
    }
    return this.#components.get(entity)!;
  }

  get(entity: EntityId) {
    return this.#components.get(entity);
  }

  has(entity: EntityId) {
    return this.#components.has(entity);
  }

  delete(entity: EntityId) {
    this.#components.delete(entity);
  }

  clear() {
    this.#components.clear();
  }

  entries() {
    return this.#components.entries();
  }

  values() {
    return this.#components.values();
  }

  keys() {
    return this.#components.keys();
  }

  forEach(cb: (value: T, entity: EntityId) => void) {
    this.#components.forEach((value, key) => cb(value, key));
  }
}
