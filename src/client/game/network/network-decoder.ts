import type { NetworkEvent } from "@/shared/network/events";
import type { ClientEngine } from "../client-engine";

export type NetEventCallback = (event: NetworkEvent) => void;

export class NetworkDecoder {
  #engine: ClientEngine;

  // Очередь декодированных сообщений, отсортированная по serverTime
  #messageQueue: Array<{
    message: NetworkEvent;
    cb: NetEventCallback;
    receiveOrder: number; // Порядковый номер получения для сообщений без serverTime
    serverTime?: number; // Извлекается из message если есть
  }> = [];

  #processingQueue = false; // Флаг, чтобы не обрабатывать очередь параллельно
  #receiveCounter = 0; // Счетчик для отслеживания порядка получения

  get #fakeLatency() {
    return this.#engine.simulatedLatencyMs;
  }

  constructor(engine: ClientEngine) {
    this.#engine = engine;
  }

  async process(event: MessageEvent<any>, cb: NetEventCallback) {
    const receiveOrder = ++this.#receiveCounter;

    const message = await this.#decodeMessage(event.data);
    this.#enqueueMessage(message, receiveOrder, cb);

    await this.#processQueue();
  }

  async #decodeMessage(
    payload: string | ArrayBuffer | Blob
  ): Promise<NetworkEvent> {
    const isGzip = await this.#isGzipCompressed(payload);

    let raw: string;
    if (isGzip) {
      raw = await this.#decompressGzip(payload);
    } else {
      raw = typeof payload === "string" ? payload : payload.toString();
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

    // Используем DecompressionStream API для декодирования gzip
    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    writer.write(new Uint8Array(arrayBuffer));
    writer.close();

    const chunks: Uint8Array[] = [];
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        chunks.push(value);
      }
    }

    // Объединяем все chunks в один ArrayBuffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Конвертируем в строку
    const decoder = new TextDecoder();
    return decoder.decode(result);
  }

  #enqueueMessage(
    message: NetworkEvent,
    receiveOrder: number,
    cb: NetEventCallback
  ) {
    // Извлекаем serverTime если есть (у ServerStateEvent и ServerPongEvent)
    const serverTime = this.#extractServerTime(message);

    this.#messageQueue.push({
      message,
      receiveOrder,
      serverTime,
      cb,
    });

    // Сортируем очередь:
    // 1. Сначала по serverTime (если есть), по возрастанию
    // 2. Затем по receiveOrder для сообщений без serverTime
    this.#messageQueue.sort((a, b) => {
      // Если у обоих есть serverTime - сортируем по нему
      if (a.serverTime !== undefined && b.serverTime !== undefined) {
        return a.serverTime - b.serverTime;
      }
      // Если только у одного есть serverTime - он приоритетнее
      if (a.serverTime !== undefined) return -1;
      if (b.serverTime !== undefined) return 1;
      // Если у обоих нет serverTime - по порядку получения
      return a.receiveOrder - b.receiveOrder;
    });
  }

  #extractServerTime(message: NetworkEvent): number | undefined {
    if ("serverTime" in message && typeof message.serverTime === "number") {
      return message.serverTime;
    }
    return undefined;
  }

  async #processQueue() {
    // Предотвращаем параллельную обработку
    if (this.#processingQueue) {
      return;
    }

    this.#processingQueue = true;

    try {
      // Обрабатываем все сообщения из очереди по порядку
      while (this.#messageQueue.length > 0) {
        const { message, cb } = this.#messageQueue.shift()!;
        cb(message);
      }
    } finally {
      this.#processingQueue = false;
    }
  }
}
