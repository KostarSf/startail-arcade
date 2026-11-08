import { mkdir } from "node:fs/promises";
import { Random } from "../src/shared/math/random";

const out = ".artifacts/optimization-lab";
await mkdir(out, { recursive: true });
const baseline = Bun.spawnSync([
  "git",
  "show",
  "b27ee49:src/client/game/network/presentation-timing-controller.ts",
]);
if (baseline.exitCode) throw new Error(baseline.stderr.toString());
const source = baseline.stdout.toString();
const targetAssignment = /#targetDelayMs = clamp\([\s\S]*?\n      \);/;
const modes = new Map<string, any>();
for (const name of [
  "adaptive-100",
  "fixed-100",
  "fixed-200",
  "adaptive-150",
  "adaptive-gap-peak",
  "adaptive-gap-margin",
]) {
  let code = source;
  if (name.startsWith("fixed")) {
    const delay = Number(name.split("-")[1]);
    code = code
      .replace(targetAssignment, `#targetDelayMs = ${delay};`)
      .replace("#targetDelayMs = 100;", `#targetDelayMs = ${delay};`);
  }
  if (name === "adaptive-150")
    code = code
      .replace("        100,\n        400,", "        150,\n        400,")
      .replace("#targetDelayMs = 100;", "#targetDelayMs = 150;");
  if (name.startsWith("adaptive-gap"))
    code = code
      .replace(
        "receivedAtMs - this.#lastArrival - elapsed",
        "receivedAtMs - this.#lastArrival - this.#cadenceMs",
      )
      .replace("this.#jitter.length > 60", "this.#jitter.length > 180")
      .replace("percentile(this.#jitter, 0.95, 0)", "percentile(this.#jitter, 1, 0)");
  if (name === "adaptive-gap-margin")
    code = code.replace(
      "2 * this.#cadenceMs + percentile(this.#jitter, 1, 0)",
      "Math.max(2 * this.#cadenceMs, this.#cadenceMs + percentile(this.#jitter, 1, 0))",
    );
  await Bun.write(`${out}/timing-${name}.ts`, code);
  modes.set(
    name,
    (await import(`../.artifacts/optimization-lab/timing-${name}.ts`)).PresentationTimingController,
  );
}
modes.set(
  "production",
  (await import("../src/client/game/network/presentation-timing-controller"))
    .PresentationTimingController,
);
const results: any[] = [];
for (const scenario of ["stable", "jitter-120", "stall-180", "coalesced-stall-180"]) {
  const random = new Random(42),
    packets: { server: number; arrival: number }[] = [];
  let lastArrival = 0;
  for (let server = 50; server <= 30000; server += 50) {
    if (scenario === "coalesced-stall-180" && server % 5000 >= 1000 && server % 5000 < 1150)
      continue;
    let arrival = server + 40 + (scenario === "jitter-120" ? random.next() * 120 : 0);
    if (scenario === "stall-180" && server % 5000 === 1000) arrival += 180;
    if (scenario === "coalesced-stall-180" && server % 5000 === 1150) arrival += 30;
    arrival = Math.max(arrival, lastArrival);
    lastArrival = arrival;
    packets.push({ server, arrival });
  }
  for (const [variant, Controller] of modes) {
    const controller = new Controller();
    let i = 0,
      latest: number | null = null,
      prev: number | null = null,
      starved = 0,
      held = 0,
      reversals = 0,
      frames = 0;
    const delays: number[] = [],
      speeds: number[] = [];
    for (let now = 0; now < 30000; now += 1000 / 60) {
      while (i < packets.length && packets[i]!.arrival <= now) {
        const p = packets[i++]!;
        latest = p.server;
        controller.observeSnapshot(
          { serverTime: p.server, stream: { health: "normal" } },
          p.arrival,
        );
      }
      const target = controller.updateWindow({
        predictedServerTime: now - 40,
        latestSnapshotServerTime: latest,
        hasNextSnapshot: true,
        dtMs: 1000 / 60,
      });
      if (target !== null && prev !== null && now >= 1000) {
        frames++;
        if (target < prev) reversals++;
        if (latest !== null && target > latest) starved++;
        const speed = (target - prev) / (1000 / 60);
        speeds.push(speed);
        if (speed < 0.5) held++;
        delays.push(now - 40 - target);
      }
      prev = target;
    }
    delays.sort((a, b) => a - b);
    speeds.sort((a, b) => a - b);
    results.push({
      scenario,
      variant,
      frames,
      starved,
      held,
      reversals,
      delayP50: delays[Math.floor(delays.length * 0.5)],
      delayP95: delays[Math.floor(delays.length * 0.95)],
      speedP95: speeds[Math.floor(speeds.length * 0.95)],
    });
  }
}
console.log(JSON.stringify(results, null, 2));
await Bun.write(`${out}/playback-results.json`, JSON.stringify(results, null, 2));
