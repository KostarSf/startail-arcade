import type { ComponentStore } from "./component-store";
import type { EntityId } from "./entity-manager";

type ComponentTuple<T extends ComponentStore<unknown>[]> = {
  [K in keyof T]: T[K] extends ComponentStore<infer U> ? U : never;
};

export function* view<T extends ComponentStore<unknown>[]>(
  ...stores: T
): Generator<[EntityId, ...ComponentTuple<T>]> {
  if (stores.length === 0) return;
  const [primary, ...rest] = stores as unknown as [
    ComponentStore<unknown>,
    ...ComponentStore<unknown>[],
  ];
  for (const [entity, primaryValue] of primary.entries()) {
    const components: unknown[] = [primaryValue];
    let missing = false;
    for (const store of rest) {
      const value = store.get(entity);
      if (value === undefined) {
        missing = true;
        break;
      }
      components.push(value);
    }
    if (!missing) {
      yield [entity, ...(components as ComponentTuple<T>)] as [
        EntityId,
        ...ComponentTuple<T>,
      ];
    }
  }
}
