import type { Vector2 } from "@/shared/math/vector";
import type { BaseEntity } from "../entities/base-entity";

/**
 * A uniform grid is a grid that is used to store entities in a world.
 *
 * Used to efficiently query entities in a given area.
 */
export class UniformGrid {
  static CELL_SIZE = 500;
  // Use a prime multiplier for the key to separate x and y components safely
  // Assuming map fits within +/- 300 cells (150,000 pixels), 1000 is safe.
  static KEY_MULTIPLIER = 10000;

  /** A map of cell coordinates to the entities in that cell. */
  #cells = new Map<number, Set<BaseEntity>>();
  /** A map of entities to their cell coordinates. */
  #entities = new Map<BaseEntity, number>();

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

    if (oldIndex !== undefined) {
      const oldCell = this.#cells.get(oldIndex);
      oldCell?.delete(entity);
      // Cleanup empty cells to save memory
      if (oldCell && oldCell.size === 0) {
        this.#cells.delete(oldIndex);
      }
    }

    const newCell = this.#getOrCreateCell(index);
    newCell.add(entity);
    this.#entities.set(entity, index);
  }

  remove(entity: BaseEntity) {
    const index = this.#entities.get(entity);
    if (index === undefined) {
      return;
    }

    const cell = this.#cells.get(index);
    cell?.delete(entity);
    if (cell && cell.size === 0) {
      this.#cells.delete(index);
    }
    this.#entities.delete(entity);
  }

  /**
   * Returns entities in the cells overlapping the query area.
   */
  query(
    pos: Vector2,
    radius: number,
    changedOnly: boolean = false
  ): BaseEntity[] {
    const minX = Math.floor((pos.x - radius) / UniformGrid.CELL_SIZE);
    const maxX = Math.floor((pos.x + radius) / UniformGrid.CELL_SIZE);
    const minY = Math.floor((pos.y - radius) / UniformGrid.CELL_SIZE);
    const maxY = Math.floor((pos.y + radius) / UniformGrid.CELL_SIZE);

    const result: BaseEntity[] = [];

    for (let i = minX; i <= maxX; i++) {
      for (let j = minY; j <= maxY; j++) {
        const key = i * UniformGrid.KEY_MULTIPLIER + j;
        const cell = this.#cells.get(key);
        if (cell) {
          for (const entity of cell) {
            if (changedOnly ? entity.changed : !entity.removed) {
              result.push(entity);
            }
          }
        }
      }
    }

    return result;
  }

  #getOrCreateCell(index: number) {
    let cell = this.#cells.get(index);
    if (!cell) {
      cell = new Set<BaseEntity>();
      this.#cells.set(index, cell);
    }
    return cell;
  }

  #getCellIndex(x: number, y: number) {
    const ix = Math.floor(x / UniformGrid.CELL_SIZE);
    const iy = Math.floor(y / UniformGrid.CELL_SIZE);
    return ix * UniformGrid.KEY_MULTIPLIER + iy;
  }

  clear() {
    this.#cells.clear();
    this.#entities.clear();
  }
}
