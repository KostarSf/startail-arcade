import { expect, test } from "@playwright/test";

test("own bullet renders before its network round trip and keeps its ECS identity on confirmation", async ({
  page,
}) => {
  const errors: string[] = [];
  const sentShots: number[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(payload.toString());
      if (message.type === "player:input" && message.input.fire)
        sentShots.push(message.input.shotId);
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?agent-rendered=true&audio=off");
  await page.waitForFunction(() => window.__STARTAIL_TEST_API__?.getSnapshot().connected);
  await page.evaluate(() => window.__STARTAIL_TEST_API__!.respawn("Predicted Shot"));
  await page.waitForFunction(() => {
    const api = window.__STARTAIL_TEST_API__!;
    const debug = api.getDebugNetworkSnapshot();
    return (
      api.getSnapshot().stats.hasTimeSync &&
      debug?.rendering?.tickerStarted &&
      debug.ships.some(
        (s) =>
          s.id === debug.player.id &&
          s.screenX !== null &&
          s.screenY !== null &&
          Math.abs(s.screenX - 640) < 100 &&
          Math.abs(s.screenY - 360) < 100,
      )
    );
  });
  const first = await page.evaluate(async () => {
    const api = window.__STARTAIL_TEST_API__!;
    api.configureDebug({ simulatedLatencyMs: 150 });
    api.sendInput({ thrust: false, angle: 0, fire: true, firingCompensation: true });
    const immediate = api.getSnapshot().shots.at(-1)!;
    // Rapid extra clicks must produce neither predicted bullets nor fire commands.
    for (let i = 0; i < 10; i++)
      api.sendInput({ thrust: false, angle: 0, fire: true, firingCompensation: true });
    const burstCount = api.getSnapshot().shots.length;
    for (let i = 0; i < 2; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      immediate,
      burstCount,
      rendered: api.getSnapshot().shots.find((s) => s.shotId === immediate.shotId),
    };
  });
  expect(first.immediate.confirmed).toBe(false);
  expect(first.burstCount).toBe(1);
  expect(first.rendered?.rendered).toBe(true);
  expect(first.rendered?.confirmed).toBe(false);
  const entityId = first.rendered!.entityId;
  await page.waitForFunction(
    (shotId) =>
      window
        .__STARTAIL_TEST_API__!.getSnapshot()
        .shots.some((s) => s.shotId === shotId && s.confirmed && s.rendered),
    first.immediate.shotId,
  );
  const confirmed = await page.evaluate(
    (shotId) =>
      window.__STARTAIL_TEST_API__!.getSnapshot().shots.filter((s) => s.shotId === shotId),
    first.immediate.shotId,
  );
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]!.entityId).toBe(entityId);
  expect(confirmed[0]!.id).not.toMatch(/^predicted-shot:/);
  expect(sentShots).toEqual([first.immediate.shotId]);
  await page.screenshot({ path: ".artifacts/predicted-shots/confirmed.png" });
  // Lifetime/collision removal must not resurrect the bullet from delayed interpolation.
  await page.waitForFunction(
    (shotId) => !window.__STARTAIL_TEST_API__!.getSnapshot().shots.some((s) => s.shotId === shotId),
    first.immediate.shotId,
    { timeout: 10000 },
  );
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      (shotId) =>
        window.__STARTAIL_TEST_API__!.getSnapshot().shots.some((s) => s.shotId === shotId),
      first.immediate.shotId,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  expect(sentShots).toEqual([first.immediate.shotId]);
});
