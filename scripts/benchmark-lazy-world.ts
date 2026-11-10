import { mkdir } from "node:fs/promises";
import { World } from "../src/server/engine/world/world";
import { Ship } from "../src/server/engine/entities/ship";
import { Random } from "../src/shared/math/random";

const mode = process.argv[2] ?? "normal";
if (!["normal", "near-50"].includes(mode)) throw new Error("Use normal or near-50");
await mkdir(".artifacts/lazy-world-review", { recursive: true });
const random = new Random(42);
Math.random = () => random.next();
const world = new World();
const engine: any = {
  tick: 0,
  debug: {},
  network: { players: [], handleEntityDestroyed() {} },
  measurePerformance: (_: string, fn: () => unknown) => fn(),
  markProfiledTick() {},
};
// Stress fixture: all 50 spawn within 1,500 units of the player. Normal run uses the ordinary seeded world.
let calls = 0;
if (mode === "near-50")
  Math.random = () => {
    const n = calls++,
      value = random.next();
    return n >= 3 && (n - 3) % 4 < 2 ? 0.5 + (value - 0.5) * 0.03 : value;
  };
Bun.gc(true);
const before = process.memoryUsage(),
  started = performance.now();
world.initialize(engine);
const initializationMs = performance.now() - started;
Math.random = () => random.next();
Bun.gc(true);
const initialized = process.memoryUsage();
const player = new Ship({ x: 0, y: 0, maxHealth: 1000000, health: 1000000 });
const p: any = { ship: player, cameraViewBounds: null, addScore() {} };
player.player = p;
world.spawn(player);
engine.network.players.push(p);
const samples: number[] = [];
let maxResident = 0,
  maxActivePirates = 0,
  firstPlayerTick: number | null = null,
  maxQueued = 0;
for (let tick = 1; tick <= 600; tick++) {
  engine.tick = tick;
  // One bounded preparation slice per simulated frame (more conservative than the live setImmediate loop).
  world.prepareStreaming(2);
  const start = performance.now();
  world.update(0.05);
  world.postUpdate(0.05);
  samples.push(performance.now() - start);
  const stats = world.getActivityStats();
  maxResident = Math.max(maxResident, world.entities.length);
  maxActivePirates = Math.max(maxActivePirates, stats.pirates.active);
  maxQueued = Math.max(maxQueued, stats.streaming.queuedChunks);
  if (player.initialized && firstPlayerTick === null) firstPlayerTick = tick;
  if (mode === "normal" && tick % 100 === 0) {
    player.x = (tick / 100) * 6500 - 20000;
    player.y = tick % 200 ? 49900 : -49900;
    world.updateSpatialIndex(player);
  }
}
Bun.gc(true);
const running = process.memoryUsage(),
  activity = world.getActivityStats();
world.clear();
Bun.gc(true);
const cleared = process.memoryUsage();
const sorted = [...samples].sort((a, b) => a - b);
const result = {
  mode,
  seed: 42,
  initializationMs,
  firstPlayerTick,
  ticks: 600,
  maxResident,
  maxActivePirates,
  maxQueued,
  tickMs: {
    p50: sorted[300],
    p95: sorted[570],
    p99: sorted[594],
    max: sorted.at(-1),
    over50: samples.filter((t) => t > 50).length,
  },
  memory: { before, initialized, running, cleared },
  activity,
  afterClear: world.getActivityStats(),
};
await Bun.write(
  `.artifacts/lazy-world-review/benchmark-${mode}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
