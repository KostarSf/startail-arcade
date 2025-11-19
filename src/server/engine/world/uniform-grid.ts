import type { Vector2 } from "@/shared/math/vector";
import type { BaseEntity } from "../entities/base-entity";

/**
 * A uniform grid is a grid that is used to store entities in a world.
 *
 * Used to efficiently query entities in a given area.
 */
export class UniformGrid {
  static CELL_SIZE = 500;

  /** A map of cell coordinates to the entities in that cell. */
  #cells = new Map<string, Set<BaseEntity>>();
  /** A map of entities to their cell coordinates. */
  #entities = new Map<BaseEntity, string>();

  constructor(entities?: BaseEntity[]) {
    if (entities) {
      for (const entity of entities) {
        this.update(entity);
      }
    }
  }

  update(entity: BaseEntity) {
    const index = this.#getCellIndex(entity.x, entity.y);
    const oldIndex = this.#entities.get(entity);

    if (index === oldIndex) {
      return;
    }

    if (oldIndex) {
      const oldCell = this.#getOrCreateCell(oldIndex);
      oldCell.delete(entity);
    }

    const newCell = this.#getOrCreateCell(index);
    newCell.add(entity);
    this.#entities.set(entity, index);
  }

  remove(entity: BaseEntity) {
    const index = this.#entities.get(entity);
    if (!index) {
      return;
    }

    const cell = this.#getOrCreateCell(index);
    cell.delete(entity);
    this.#entities.delete(entity);
  }

  query(pos: Vector2, radius: number) {
    const indexes = new Set<string>();
    const minX = Math.floor((pos.x - radius) / UniformGrid.CELL_SIZE);
    const maxX = Math.floor((pos.x + radius) / UniformGrid.CELL_SIZE);
    const minY = Math.floor((pos.y - radius) / UniformGrid.CELL_SIZE);
    const maxY = Math.floor((pos.y + radius) / UniformGrid.CELL_SIZE);

    for (let i = minX; i <= maxX; i++) {
      for (let j = minY; j <= maxY; j++) {
        indexes.add(`${i},${j}`);
      }
    }

    const entities = new Set<BaseEntity>();

    for (const index of indexes) {
      const cell = this.#getOrCreateCell(index);
      for (const entity of cell) {
        entities.add(entity);
      }
    }

    return entities;
  }

  #getOrCreateCell(index: string) {
    let cell = this.#cells.get(index);
    if (!cell) {
      cell = new Set<BaseEntity>();
      this.#cells.set(index, cell);
    }
    return cell;
  }

  #getCellIndex(x: number, y: number) {
    return `${Math.floor(x / UniformGrid.CELL_SIZE)},${Math.floor(
      y / UniformGrid.CELL_SIZE
    )}`;
  }

  clear() {
    this.#cells.clear();
    this.#entities.clear();
  }
}
