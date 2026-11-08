import { Engine } from "../src/server/engine/engine";
import { Random } from "../src/shared/math/random";
import { mkdir } from "node:fs/promises";

const label = process.argv[2] ?? "after";
const out = ".artifacts/optimization-lab";
await mkdir(out, { recursive: true });
const random = new Random(42);
Math.random = () => random.next();
const engine = new Engine();
const metrics = new Map<string, number[]>();
const add = (k: string, n: number) => {
  let a = metrics.get(k);
  if (!a) metrics.set(k, (a = []));
  a.push(n);
};
engine.measurePerformance = (metric, fn) => {
  const start = performance.now();
  const value = fn();
  if (
    metric === "wakeStabilizationMs" ||
    metric === "chunkActivityUpdateMs" ||
    metric === "networkSerializeMs"
  )
    add(metric, performance.now() - start);
  return value;
};
const update = engine.world.update.bind(engine.world),
  post = engine.world.postUpdate.bind(engine.world);
let tickStart = 0,
  activeMax = 0;
engine.world.update = (dt) => {
  const phase = Math.floor((engine.tick - 1) / 60);
  engine.network.players.forEach((p, i) => {
    p.cameraViewBounds = {
      centerX: -18000 + i * 12000 + phase * 2500,
      centerY: i % 2 ? 6000 : -6000,
      width: 1000,
      height: 1000,
    };
  });
  tickStart = performance.now();
  update(dt);
};
engine.world.postUpdate = (dt) => {
  post(dt);
  add("tickMs", performance.now() - tickStart);
  activeMax = Math.max(activeMax, engine.world.getActivityStats().activeAsteroids);
};
const frames: number[][] = [[], [], [], []];
const sockets = frames.map((times) => ({
  getBufferedAmount: () => 0,
  close() {},
  send(data: string | Uint8Array) {
    // Only binary server:state packets; JSON connection/pong messages excluded.
    if (typeof data !== "string") times.push(performance.now());
    return 1;
  },
}));
for (const ws of sockets) engine.network.connectPlayer(ws as any);
await new Promise<void>((resolve) => {
  const check = () => {
    if (engine.tick >= 300) {
      resolve();
      return;
    }
    setTimeout(check, 25);
  };
  check();
});
const stats = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return {
    count: a.length,
    p50: a[Math.floor(a.length * 0.5)],
    p95: a[Math.floor(a.length * 0.95)],
    p99: a[Math.floor(a.length * 0.99)],
    max: a.at(-1),
    over50: values.filter((v) => v > 50).length,
  };
};
const result = {
  label,
  seed: 42,
  worldAsteroids: engine.world.getActivityStats().trackedAsteroids,
  players: 4,
  ticks: engine.tick,
  activeMax,
  metrics: Object.fromEntries([...metrics].map(([k, v]) => [k, stats(v)])),
  sendIntervals: frames.map((times) => stats(times.slice(1).map((t, i) => t - times[i]!))),
};
await Bun.write(`${out}/engine-${label}.json`, JSON.stringify(result, null, 2));
engine.stop();
console.log(JSON.stringify(result, null, 2));
