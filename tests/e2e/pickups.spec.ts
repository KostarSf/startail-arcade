import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("rendered repair rock appears on radar, opens with one shot and heals on pickup", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?agent-rendered=true&audio=off");
  await page.waitForFunction(() => window.__STARTAIL_TEST_API__?.getSnapshot().connected);
  await page.evaluate(() => window.__STARTAIL_TEST_API__!.respawn("Repair Check"));
  await page.waitForFunction(() => {
    const d = window.__STARTAIL_TEST_API__?.getDebugNetworkSnapshot();
    return d?.rendering?.tickerStarted && d.ships.some((s) => s.id === d.player.id && s.rendered);
  });
  const shipId = (await page.evaluate(() => window.__STARTAIL_TEST_API__!.getSnapshot())).player
    .id!;
  const sceneResponse = await request.post("/__test/repair-scene", { data: { shipId } });
  expect(sceneResponse.ok()).toBe(true);
  const { asteroidId } = await sceneResponse.json();
  await page.waitForFunction((id) => {
    const d = window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot();
    const rock = d.items.find((e) => e.id === id);
    return rock?.rendered && d.radar?.some((p) => p.type === "repair-asteroid");
  }, asteroidId);
  await page.evaluate(() =>
    window.__STARTAIL_TEST_API__!.sendInput({ thrust: false, angle: 0, fire: true }),
  );
  await expect
    .poll(async () => {
      const s = await (await request.get("/__test/snapshot")).json();
      return s.items.filter((e: any) => e.type === "pickup").length;
    })
    .toBe(1);
  await page.waitForFunction(() => {
    const d = window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot();
    return (
      d.items.some((e) => e.type === "pickup" && e.rendered) &&
      d.radar?.some((p) => p.type === "repair")
    );
  });
  await mkdir(".artifacts/pickups-e2e", { recursive: true });
  await page.screenshot({ path: ".artifacts/pickups-e2e/repair.png" });
  const afterShot = await (await request.get("/__test/snapshot")).json();
  expect(afterShot.items.some((e: any) => e.id === asteroidId)).toBe(false);
  const pickup = afterShot.items.find((e: any) => e.type === "pickup");
  const teleport = await request.post("/__test/teleport", {
    data: { id: shipId, x: pickup.x, y: pickup.y },
  });
  expect(teleport.ok()).toBe(true);
  await page.waitForFunction(() => {
    const d = window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot();
    return d.player.networkState?.state?.health === 65 &&
      d.effects.some((e) => e.kind === "world-pickup");
  });
  await expect
    .poll(async () => {
      const s = await (await request.get("/__test/snapshot")).json();
      return s.items.some((e: any) => e.id === pickup.id);
    })
    .toBe(false);
  await writeFile(".artifacts/pickups-e2e/result.json", JSON.stringify({
    asteroidId, pickup, healed: await page.evaluate(() => window.__STARTAIL_TEST_API__!.getDebugNetworkSnapshot().player.networkState?.state), errors,
  }, null, 2));
  expect(errors).toEqual([]);
});
