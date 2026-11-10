import type { NetworkEvent } from "@/shared/network/events";
import type { ClientEngine } from "../client-engine";

export type NetEventCallback = (event: NetworkEvent) => void;

export class NetworkDecoder {
  #engine: ClientEngine;

  #tail: Promise<void> = Promise.resolve();
  #generation = 0;

  constructor(engine: ClientEngine) {
    this.#engine = engine;
  }

  reset() {
    this.#generation++;
    this.#tail = Promise.resolve();
  }

  process(event: MessageEvent<any>, cb: NetEventCallback): Promise<void> {
    const generation = this.#generation;
    const latency = this.#engine.simulatedLatencyMs;
    // Start latency timers on arrival, but serialize decoding AND application.
    const arrival =
      latency > 0
        ? new Promise<void>((resolve) => setTimeout(resolve, latency))
        : Promise.resolve();
    const work = this.#tail.then(async () => {
      await arrival;
      if (generation !== this.#generation) return;
      const message = await this.#decodeMessage(event.data);
      if (generation === this.#generation) cb(message);
    });
    this.#tail = work.catch(() => {
      if (generation === this.#generation) this.reset();
    });
    return work;
  }

  async #decodeMessage(payload: string | ArrayBuffer | Blob): Promise<NetworkEvent> {
    const isGzip = await this.#isGzipCompressed(payload);

    let raw: string;
    if (isGzip) {
      raw = await this.#decompressGzip(payload);
    } else {
      raw =
        typeof payload === "string"
          ? payload
          : new TextDecoder().decode(
              payload instanceof Blob ? await payload.arrayBuffer() : payload,
            );
    }

    return JSON.parse(raw) as NetworkEvent;
  }

  async #isGzipCompressed(data: string | ArrayBuffer | Blob): Promise<boolean> {
    if (data instanceof ArrayBuffer) {
      const view = new Uint8Array(data);
      return view.length >= 2 && view[0] === 0x1f && view[1] === 0x8b;
    }

    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      const view = new Uint8Array(buffer);
      return view.length >= 2 && view[0] === 0x1f && view[1] === 0x8b;
    }

    // Если это строка, проверяем первые байты
    if (typeof data === "string") {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(data.substring(0, 2));
      return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    }

    return false;
  }

  async #decompressGzip(data: string | ArrayBuffer | Blob): Promise<string> {
    let arrayBuffer: ArrayBuffer;

    if (data instanceof ArrayBuffer) {
      arrayBuffer = data;
    } else if (data instanceof Blob) {
      arrayBuffer = await data.arrayBuffer();
    } else {
      // Если это строка, конвертируем в ArrayBuffer
      const encoder = new TextEncoder();
      arrayBuffer = encoder.encode(data).buffer;
    }

    const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
}
