export type EntityId = number;

export interface ComponentStoreHandle {
  delete(entity: EntityId): void;
  clear(): void;
}

export class EntityManager {
  #nextId = 1;
  #entities = new Set<EntityId>();
  #stores = new Set<ComponentStoreHandle>();

  create(id?: EntityId) {
    const entityId = id ?? this.#nextId++;
    this.#entities.add(entityId);
    if (id !== undefined && id >= this.#nextId) {
      this.#nextId = id + 1;
    }
    return entityId;
  }

  destroy(id: EntityId) {
    if (!this.#entities.delete(id)) return false;
    for (const store of this.#stores) {
      store.delete(id);
    }
    return true;
  }

  has(id: EntityId) {
    return this.#entities.has(id);
  }

  clear() {
    for (const entity of Array.from(this.#entities)) {
      this.destroy(entity);
    }
  }

  registerStore(store: ComponentStoreHandle) {
    this.#stores.add(store);
  }

  unregisterStore(store: ComponentStoreHandle) {
    this.#stores.delete(store);
  }

  forEach(cb: (entity: EntityId) => void) {
    this.#entities.forEach(cb);
  }

  get size() {
    return this.#entities.size;
  }
}
