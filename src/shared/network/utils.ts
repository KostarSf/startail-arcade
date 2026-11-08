import type { NetworkEvent } from "./events";

export function event<T extends NetworkEvent>(
  // type: T["type"],
  data: T,
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
        // Measured on real full/delta snapshots: lower tail latency with a
        // small wire-size increase, retaining browser-native gzip decoding.
        return Bun.gzipSync(message, { library: "libdeflate", level: 1 }) as TCompress extends true
          ? Uint8Array<ArrayBuffer>
          : string;
      }
      return message as TCompress extends true ? Uint8Array<ArrayBuffer> : string;
    },
  };
}

export type SerializableEvent = ReturnType<typeof event>;
