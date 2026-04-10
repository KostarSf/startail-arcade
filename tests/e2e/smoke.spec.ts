import { expect, test } from "@playwright/test";

test("player can join in agent mode", async ({ page }) => {
  await page.goto("/?agent-mode=true&audio=off");

  await page.waitForFunction(() => {
    return window.__STARTAIL_TEST_API__?.ping() === "pong";
  });

  await page.waitForFunction(() => {
    const snapshot = window.__STARTAIL_TEST_API__?.getSnapshot();
    return Boolean(snapshot?.connected);
  });

  await page.evaluate(async () => {
    window.__STARTAIL_TEST_API__?.configureDebug({
      simulatedLatencyMs: 0,
    });
    window.__STARTAIL_TEST_API__?.respawn("E2E Smoke");
  });

  await page.waitForFunction(() => {
    const snapshot = window.__STARTAIL_TEST_API__?.getSnapshot();
    return Boolean(
      snapshot?.connected &&
        snapshot.player.alive &&
        snapshot.stats.hasTimeSync &&
        (snapshot.stats.objectsCount ?? 0) > 0
    );
  });

  const snapshot = await page.evaluate(() => {
    return window.__STARTAIL_TEST_API__?.getSnapshot() ?? null;
  });

  expect(snapshot).not.toBeNull();
  expect(snapshot?.connected).toBe(true);
  expect(snapshot?.player.alive).toBe(true);
  expect(snapshot?.stats.objectsCount ?? 0).toBeGreaterThan(0);
});
