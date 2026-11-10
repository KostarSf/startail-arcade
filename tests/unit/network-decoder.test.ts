import { describe, expect, test } from "bun:test";
import { NetworkDecoder } from "../../src/client/game/network/network-decoder";
import type { ClientEngine } from "../../src/client/game/client-engine";
import { event } from "../../src/shared/network/utils";

class SlowBlob extends Blob {
  override async arrayBuffer() {
    await Bun.sleep(30);
    return super.arrayBuffer();
  }
}
const payload = (sequence: number) =>
  Bun.gzipSync(
    JSON.stringify({ type: "server:pong", sequence, clientTime: 0, serverTime: sequence * 50 }),
  );
const message = (data: Blob) => ({ data }) as MessageEvent;
const decoder = () => new NetworkDecoder({ simulatedLatencyMs: 0 } as ClientEngine);

describe("ordered network decoding", () => {
  test("production compression is compatible with the browser gzip decoder", async () => {
    const original = { type: "server:pong" as const, sequence: 1, clientTime: 10, serverTime: 50 };
    const encoded = event(original).serialize({ compress: true });
    let decoded: unknown;
    await decoder().process(message(new Blob([encoded])), (m) => {
      decoded = m;
    });
    expect(decoded).toEqual(original);
  });
  test("a slow first decode cannot be overtaken by the next packet", async () => {
    const d = decoder(),
      received: number[] = [];
    const cb = (m: any) => received.push(m.sequence);
    await Promise.all([
      d.process(message(new SlowBlob([payload(1)])), cb),
      d.process(message(new Blob([payload(2)])), cb),
    ]);
    expect(received).toEqual([1, 2]);
  });
  test("reset prevents pending packets from a previous connection applying", async () => {
    const d = decoder(),
      received: number[] = [];
    const old = d.process(message(new SlowBlob([payload(1)])), (m: any) =>
      received.push(m.sequence),
    );
    await Bun.sleep(5);
    d.reset();
    await d.process(message(new Blob([payload(2)])), (m: any) => received.push(m.sequence));
    await old;
    expect(received).toEqual([2]);
  });
  test("decoding failure invalidates the queued dependent delta", async () => {
    const d = decoder(),
      received: number[] = [];
    const bad = d.process(message(new Blob(["{"])), () => {});
    const next = d.process(message(new Blob([payload(2)])), (m: any) => received.push(m.sequence));
    await expect(bad).rejects.toThrow();
    await next;
    expect(received).toEqual([]);
  });
});
