import type { NetworkEvent } from "./events";

export function event<T extends NetworkEvent>(
  // type: T["type"],
  data: T
) {
  const payload = {
    // type,
    ...data,
  } as T;
  return {
    payload,
    serialize: () => JSON.stringify(payload),
  };
}

export type SerializableEvent = ReturnType<typeof event>;
