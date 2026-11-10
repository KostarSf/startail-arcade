import { Engine } from "../src/server/engine/engine";
import { Random } from "../src/shared/math/random";
import { mkdir } from "node:fs/promises";

const out = ".artifacts/optimization-lab";
await mkdir(out, { recursive: true });
const random = new Random(42);
Math.random = () => random.next();
const engine = new Engine();
engine.debug.disableCompression = true;
const packets: string[] = [];
console.log("Capturing 100 real snapshots with a fake transport");
await new Promise<void>((done) => {
  const ws = {
    getBufferedAmount: () => 0,
    close() {},
    send(data: string) {
      if (JSON.parse(data).type === "server:state") packets.push(data);
      if (packets.length === 100)
        setImmediate(() => {
          engine.stop();
          done();
        });
      return 1;
    },
  };
  engine.network.connectPlayer(ws as any);
  engine.network.onMessage(ws as any, { type: "player:respawn", name: "Compression Benchmark" });
});
await Bun.write(`${out}/packets.json`, JSON.stringify(packets));
const stats = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return { p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s.at(-1) };
};
const variants = new Map<string, (text: string) => string | Uint8Array<ArrayBuffer>>([
  ["plain", (text) => text],
  ["gzip-default", (text) => Bun.gzipSync(text)],
  ["gzip-1", (text) => Bun.gzipSync(text, { level: 1 })],
  ["gzip-3", (text) => Bun.gzipSync(text, { level: 3 })],
  ["libdeflate-1", (text) => Bun.gzipSync(text, { library: "libdeflate", level: 1 })],
  ["libdeflate-3", (text) => Bun.gzipSync(text, { library: "libdeflate", level: 3 })],
  ["libdeflate-6", (text) => Bun.gzipSync(text, { library: "libdeflate", level: 6 })],
]);
const results: any[] = [];
// Same captured packet contents, six rotated passes, discard warm-up.
const samples = new Map([...variants.keys()].map((k) => [k, [] as number[]]));
for (let pass = 0; pass < 6; pass++) {
  const names = [...variants.keys()];
  names.push(...names.splice(0, pass));
  for (const name of names) {
    const encode = variants.get(name)!;
    for (const text of packets) {
      const start = performance.now(),
        encoded = encode(text),
        elapsed = performance.now() - start;
      if (pass) samples.get(name)!.push(elapsed);
      const decoded =
        typeof encoded === "string" ? encoded : new TextDecoder().decode(Bun.gunzipSync(encoded));
      if (decoded !== text) throw new Error(`Round trip failed: ${name}`);
    }
  }
}
for (const [variant, encode] of variants) {
  const bytes = packets.map((t) => {
    const e = encode(t);
    return typeof e === "string" ? Buffer.byteLength(e) : e.byteLength;
  });
  results.push({
    variant,
    ms: stats(samples.get(variant)!),
    bytes: stats(bytes),
    totalBytes: bytes.reduce((a, b) => a + b, 0),
    samples: samples.get(variant)!.length,
  });
}
await Bun.write(
  `${out}/compression-results.json`,
  JSON.stringify({ bun: Bun.version, packets: packets.length, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
