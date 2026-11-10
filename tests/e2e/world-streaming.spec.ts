import { expect, test, type Page } from "@playwright/test";
import { WORLD_CONFIG, resolveWorldConfig } from "../../src/server/engine/world/world-config";

const { borderRadius, targetAsteroids, targetPirates } = resolveWorldConfig(WORLD_CONFIG);

async function join(page: Page, name: string, rendered = false) {
  await page.goto(`/?${rendered ? "agent-rendered" : "agent-mode"}=true&audio=off`);
  await page.waitForFunction(() => window.__STARTAIL_TEST_API__?.getSnapshot()?.connected);
  await page.evaluate((name) => window.__STARTAIL_TEST_API__!.respawn(name), name);
  await page.waitForFunction(() => {
    const s = window.__STARTAIL_TEST_API__?.getSnapshot();
    return s?.player.alive && (s.stats.objectsCount ?? 0) > 0;
  });
  if (rendered)
    await page.waitForFunction(() => {
      const debug = window.__STARTAIL_TEST_API__?.getDebugNetworkSnapshot();
      return debug?.ships.some((s) => s.id === debug.player.id && s.rendered);
    });
  return (await page.evaluate(() => window.__STARTAIL_TEST_API__!.getSnapshot())).player.id!;
}

test("the last browser disconnect clears resident, cold, queued and pirate state", async ({
  page,
  context,
  request,
}) => {
  await join(page, "Reset One");
  const second = await context.newPage();
  await join(second, "Reset Two");
  const before = await (await request.get("/__test/metrics")).json();
  // Loaded asteroids may already have collided/died before the browsers join.
  expect(before.activity.logicalAsteroids).toBeLessThanOrEqual(targetAsteroids);
  expect(before.activity.logicalAsteroids).toBeGreaterThan(targetAsteroids * 0.98);
  expect(before.activity.pirates.total).toBe(targetPirates);
  expect(before.entityCount).toBeLessThan(20000);
  await page.close();
  await expect
    .poll(async () => (await (await request.get("/__test/metrics")).json()).playerCount)
    .toBe(1);
  await second.close();
  await expect
    .poll(async () => (await (await request.get("/__test/metrics")).json()).running)
    .toBe(false);
  const cleared = await (await request.get("/__test/metrics")).json();
  expect(cleared.tick).toBe(0);
  expect(cleared.entityCount).toBe(0);
  expect(cleared.activity.pirates.total).toBe(0);
  expect(cleared.activity.streaming).toMatchObject({
    residentChunks: 0,
    coldChunks: 0,
    queuedChunks: 0,
    readyChunks: 0,
    storedBytes: 0,
  });
  const next = await context.newPage();
  await join(next, "Fresh World");
  const after = await (await request.get("/__test/metrics")).json();
  expect(after.activity.streaming.seed).not.toBe(before.activity.streaming.seed);
  expect(after.activity.pirates.total).toBe(targetPirates);
  await next.close();
});

test("a rendered pursuit and combat effects survive the world seam", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const playerId = await join(page, "Seam Chase", true);
  const initial = await (await request.get("/__test/snapshot")).json();
  const pirate = initial.pirates[0];
  const teleport = async (id: string, x: number, y: number, targetId?: string) => {
    // Isolate streaming/pursuit from accidental deaths when teleporting into a dense field.
    const response = await request.post("/__test/teleport", {
      data: { id, x, y, targetId, health: 1000000 },
    });
    expect(response.ok()).toBe(true);
  };
  await teleport(playerId, pirate.x + 300, pirate.y);
  await expect
    .poll(async () => {
      const s = await (await request.get("/__test/snapshot")).json();
      return s.pirates.find((p: any) => p.id === pirate.id)?.active;
    })
    .toBe(true);
  await teleport(playerId, -borderRadius + 100, -borderRadius + 100);
  await teleport(pirate.id, borderRadius - 100, borderRadius - 100, playerId);
  // Teleports deliberately bypass prefetch. Wait for the cold area to finish
  // loading before asserting rendered visibility, while the pursuit stays pinned.
  await expect
    .poll(
      async () => {
        const s = await (await request.get("/__test/snapshot")).json();
        return s.pirates.find((p: any) => p.id === pirate.id);
      },
      { timeout: 20000 },
    )
    .toMatchObject({ active: true, initialized: true, pursuitTargetId: playerId });
  await page.waitForTimeout(1000);
  const first = await (await request.get("/__test/snapshot")).json();
  expect(first.pirates.find((p: any) => p.id === pirate.id)).toMatchObject({
    active: true,
    pursuitTargetId: playerId,
  });
  await expect
    .poll(async () =>
      page.evaluate(
        (id) =>
          window
            .__STARTAIL_TEST_API__!.getDebugNetworkSnapshot()
            ?.ships.some(
              (s) =>
                s.id === id &&
                s.rendered &&
                s.screenX !== null &&
                s.screenY !== null &&
                s.screenX >= 0 &&
                s.screenX <= 1280 &&
                s.screenY >= 0 &&
                s.screenY <= 720,
            ),
        pirate.id,
      ),
    )
    .toBe(true)
    .catch(async (error) => {
      console.log(
        "Pursuit visibility diagnostics",
        JSON.stringify({
          client: await page.evaluate(() =>
            window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot(),
          ),
          server: await (await request.get("/__test/snapshot")).json(),
        }),
      );
      throw error;
    });
  await teleport(pirate.id, -borderRadius + 50, -borderRadius + 50, playerId);
  await page.waitForTimeout(700);
  const second = await (await request.get("/__test/snapshot")).json();
  expect(second.pirates.find((p: any) => p.id === pirate.id)).toMatchObject({
    active: true,
    pursuitTargetId: playerId,
  });
  expect(
    await page.evaluate(
      () => window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot()?.rendering?.tickerStarted,
    ),
  ).toBe(true);
  // Exercise actual damage/death events from a visible NPC on the opposite side.
  // Sample each frame because an explosion only lives for half a second.
  for (const amount of [17, 10000000]) {
    // Combat can push the player away while the pursuit assertions run.
    await teleport(playerId, -borderRadius + 100, -borderRadius + 100);
    await teleport(pirate.id, borderRadius - 50, borderRadius - 50, playerId);
    await page.waitForTimeout(300);
    const observed = page.evaluate(async (amount) => {
      const seen = new Set<string>();
      const samples: unknown[] = [];
      const end = performance.now() + 10000;
      while (performance.now() < end) {
        const debug = window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot();
        if (debug?.effects.length && samples.length < 20) samples.push(debug.effects);
        const visible = (debug?.effects ?? []).filter(
          (effect) =>
            effect.screenX !== null &&
            effect.screenY !== null &&
            effect.screenX >= 0 &&
            effect.screenX <= 1280 &&
            effect.screenY >= 0 &&
            effect.screenY <= 720,
        );
        const damage = visible.find((effect) => effect.text === `-${amount}`);
        if (damage) {
          seen.add("world-damage-text");
          if (
            visible.some(
              (effect) =>
                effect.kind === "world-explosion" &&
                Math.abs(effect.screenX! - damage.screenX!) < 20 &&
                Math.abs(effect.screenY! - damage.screenY!) < 40,
            )
          )
            seen.add("world-explosion");
        }
        if (seen.size === 2) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return {
        seen: [...seen],
        samples,
        debug: window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot(),
      };
    }, amount);
    const hit = await request.post("/__test/damage", { data: { id: pirate.id, amount } });
    expect(hit.ok()).toBe(true);
    const result = await observed;
    if (result.seen.length !== 2)
      console.log("Combat effect diagnostics", JSON.stringify({ amount, ...result }));
    expect(result.seen).toEqual(expect.arrayContaining(["world-damage-text", "world-explosion"]));
  }
  await expect
    .poll(async () => {
      const s = await (await request.get("/__test/snapshot")).json();
      return s.pirates.some((p: any) => p.id === pirate.id);
    })
    .toBe(false);
  expect(errors).toEqual([]);
});
