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
    serialize: <TCompress extends boolean = false>(args?: {
      compress?: TCompress;
    }): TCompress extends true ? Uint8Array<ArrayBuffer> : string => {
      const message = JSON.stringify(payload);
      if (args?.compress === true) {
        return Bun.gzipSync(message) as TCompress extends true
          ? Uint8Array<ArrayBuffer>
          : string;
      }
      return message as TCompress extends true
        ? Uint8Array<ArrayBuffer>
        : string;
    },
  };
}

export type SerializableEvent = ReturnType<typeof event>;
