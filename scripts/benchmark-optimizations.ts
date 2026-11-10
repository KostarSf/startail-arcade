// Run with bun. Frozen baseline is extracted from git; all output is ignored.
import { mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { Asteroid } from "../src/server/engine/entities/asteroid";
import { Random } from "../src/shared/math/random";
import { WakeSpatialGrid } from "../src/server/engine/world/wake-spatial-grid";
import type { World } from "../src/server/engine/world/world";

const out = resolve(".artifacts/optimization-lab");
await mkdir(out, { recursive: true });
const baseline = Bun.spawnSync([
  "git",
  "show",
  "31d71ae:src/server/engine/world/chunk-activity-manager.ts",
]);
if (baseline.exitCode) throw new Error(baseline.stderr.toString());
const original = baseline.stdout
  .toString()
  .replace(
    /from "(\.[^"]+)"/g,
    (_, path) =>
      `from ${JSON.stringify(relative(out, resolve("src/server/engine/world", path)).replaceAll("\\", "/"))}`,
  );
const narrowFilter = `const dx = other.x - asteroid.x, dy = other.y - asteroid.y;
            const r = asteroid.radius + other.radius;
            if (dx * dx + dy * dy >= r * r) continue;
            const pairKey = this.#getPairKey(asteroid, other);`;
const gridBody = `
    if (!this.#justWokeChunks.size) return;
    const grid = new WakeSpatialGrid(this.#activeAsteroids, CELL_SIZE);
    const processedPairs = new Set<string>();
    // Freeze the wake set before separation changes chunk membership.
    const waking = Array.from(this.#activeAsteroids).filter(a =>
      !a.removed && this.#justWokeChunks.has(this.getChunkIndexAt(a.x, a.y)));
    for (const asteroid of waking) {
      for (const other of grid.query(asteroid)) {
        if (asteroid === other || other.removed) continue;
        ${narrowFilter}
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);
        this.#separateAsteroidPair(world, asteroid, other,
          this.#justWokeChunks.has(this.getChunkIndexAt(other.x, other.y)));
        grid.update(asteroid);
        grid.update(other);
      }
    }
    for (const index of this.#justWokeChunks) {
      const state = this.#chunkStates.get(index);
      if (state) state.stabilizationPending = false;
    }
  `;
const variants = new Map<string, any>();
for (const name of ["original", "distance-filter", "grid-32", "grid-64", "grid-128", "grid-500"]) {
  let source = original;
  if (name === "distance-filter")
    source = source.replace("const pairKey = this.#getPairKey(asteroid, other);", narrowFilter);
  if (name.startsWith("grid-")) {
    source =
      `import { WakeSpatialGrid } from "../../src/server/engine/world/wake-spatial-grid";\n` +
      source;
    const start = source.indexOf("  applyWakeStabilization(world: World) {");
    const end = source.indexOf("  /** Returns the asteroid snapshot", start);
    source =
      source.slice(0, start) +
      "  applyWakeStabilization(world: World) {" +
      gridBody.replace("CELL_SIZE", name.split("-")[1]!) +
      "}\n\n" +
      source.slice(end);
  }
  await Bun.write(`${out}/${name}.ts`, source);
  variants.set(
    name,
    (await import(`../.artifacts/optimization-lab/${name}.ts`)).ChunkActivityManager,
  );
}
variants.set(
  "production",
  (await import("../src/server/engine/world/chunk-activity-manager")).ChunkActivityManager,
);
const random = new Random(42);
Math.random = () => random.next();
console.log("Generating the frozen pre-streaming 500,000 asteroid fixture, seed=42");
// Residency is now lazy. Keep this historical broad-phase comparison on its
// original fixture instead of accidentally benchmarking an empty live world.
const fixtureSource = Bun.spawnSync(["git", "show", "49ab5aa:src/server/engine/world/world.ts"]);
if (fixtureSource.exitCode) throw new Error(fixtureSource.stderr.toString());
await Bun.write(
  `${out}/fixture-world.ts`,
  fixtureSource.stdout
    .toString()
    .replace("#maxAsteroids = 50000;", "#maxAsteroids = 500000;")
    .replace(
      /from "(\.[^"]+)"/g,
      (_, path) =>
        `from ${JSON.stringify(relative(out, resolve("src/server/engine/world", path)).replaceAll("\\", "/"))}`,
    ),
);
const fixtureModule = "../.artifacts/optimization-lab/fixture-world.ts";
const FixtureWorld: new () => World = (await import(fixtureModule)).World;
const fixtureWorld = new FixtureWorld();
fixtureWorld.initialize({ tick: 0, debug: {}, network: { players: [] } } as any);
const all = fixtureWorld.entities
  .filter((a) => a.type === "asteroid")
  .map((a) => ({ x: a.x, y: a.y, radius: a.radius }));
fixtureWorld.clear();
const density = new Map<string, { x: number; y: number; n: number }>();
for (const a of all) {
  const x = Math.floor(a.x / 4000) * 4000 + 2000,
    y = Math.floor(a.y / 4000) * 4000 + 2000;
  const key = `${x}:${y}`,
    bin = density.get(key) ?? { x, y, n: 0 };
  bin.n++;
  density.set(key, bin);
}
const dense = [...density.values()].sort((a, b) => b.n - a.n);
const scenes = [
  { name: "origin", centers: [{ x: 0, y: 0 }] },
  { name: "dense", centers: [dense[0]!] },
  { name: "four-players", centers: [dense[0]!, dense[10]!, dense[20]!, dense[30]!] },
];
const stats = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    max: s.at(-1),
  };
};
const results: any[] = [];
for (const scene of scenes) {
  const fixture = all.filter((a) =>
    scene.centers.some((c) => Math.abs(a.x - c.x) < 4000 && Math.abs(a.y - c.y) < 4000),
  );
  const samples = new Map([...variants.keys()].map((n) => [n, [] as number[]]));
  const correctness = new Map<string, any>();
  // Rotate order; exclude two warm-ups. Setup and GC are outside the timer.
  for (let rep = 0; rep < 12; rep++) {
    const names = [...variants.keys()];
    names.push(...names.splice(0, rep % names.length));
    for (const name of names) {
      const manager = new (variants.get(name))();
      const world: any = {
        borderRadius: 50000,
        engine: {
          tick: 1,
          network: {
            players: scene.centers.map((c) => ({
              ship: null,
              cameraViewBounds: { centerX: c.x, centerY: c.y, width: 1000, height: 1000 },
            })),
          },
        },
        updateSpatialIndex(a: Asteroid) {
          manager.onEntityMoved(a);
        },
      };
      manager.initialize(world);
      const asteroids = fixture.map((a) => new Asteroid({ ...a, vx: 10, vy: -5, va: 0.1 }));
      for (const a of asteroids) manager.onSpawn(a);
      manager.beginTick(world, 0.05);
      if (manager.getStats().activeAsteroids < 500)
        throw new Error(`Invalid fixture ${scene.name}: ${JSON.stringify(manager.getStats())}`);
      const started = performance.now();
      manager.applyWakeStabilization(world);
      const elapsed = performance.now() - started;
      if (rep >= 2) samples.get(name)!.push(elapsed);
      const active = [...manager.getActiveAsteroids()] as Asteroid[];
      const grid = new WakeSpatialGrid(active);
      let overlapEnergy = 0,
        overlappingPairs = 0;
      for (const a of active)
        for (const b of grid.query(a)) {
          if (a.id >= b.id) continue;
          const overlap = a.radius + b.radius - Math.hypot(a.x - b.x, a.y - b.y);
          if (overlap > 1e-6) {
            overlappingPairs++;
            overlapEnergy += overlap * overlap;
          }
        }
      if (
        asteroids.some(
          (a) => a.vx !== 10 || a.vy !== -5 || a.va !== 0.1 || !Number.isFinite(a.x + a.y),
        )
      )
        throw new Error("Invalid physics");
      correctness.set(name, { active: active.length, overlappingPairs, overlapEnergy });
    }
  }
  for (const [variant, values] of samples)
    results.push({
      scene: scene.name,
      variant,
      n: values.length,
      ms: stats(values),
      ...correctness.get(variant),
    });
  console.log(
    JSON.stringify(
      results.filter((r) => r.scene === scene.name),
      null,
      2,
    ),
  );
}
await Bun.write(
  `${out}/wake-results.json`,
  JSON.stringify({ seed: 42, worldAsteroids: all.length, results }, null, 2),
);
