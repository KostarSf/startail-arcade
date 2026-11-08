import { expect, test } from "bun:test";
import { SnapshotBuffer } from "../../src/client/game/network/snapshot-buffer";
import { PresentationTimingController } from "../../src/client/game/network/presentation-timing-controller";
import type { ServerStateEvent } from "../../src/shared/network/events";

const snapshot = (tick: number): ServerStateEvent => ({
  type: "server:state",
  simTick: tick,
  serverTime: tick * 50,
  baseSimTick: null,
  tickDuration: 1,
  state: { type: "full", entities: [] },
  events: [],
  players: [],
});

test("stale snapshots never replace current state; missing delta baseline is rejected", () => {
  const b = new SnapshotBuffer();
  b.add(snapshot(1));
  b.add(snapshot(4));
  expect(b.add(snapshot(2))).toBe(false);
  expect(b.getLatest()!.simTick).toBe(4);
  expect(() =>
    b.add({ ...snapshot(5), baseSimTick: 3, state: { type: "partial", updated: [], removed: [] } }),
  ).toThrow("baseline");
  expect(b.getLatest()!.simTick).toBe(4);
});

test("playback remains monotonic and rate-limited through jitter, catch-up and clock corrections", () => {
  const clock = new PresentationTimingController();
  let latest = 0,
    previous: number | null = null;
  const steps: number[] = [];
  for (let now = 0; now < 5000; now += 10) {
    if (now % 50 === 0 && !(now >= 1000 && now < 1200)) {
      latest = now;
      clock.observeSnapshot(snapshot(now / 50), now + (now % 100 === 0 ? 12 : 0));
    }
    const render = clock.updateWindow({
      predictedServerTime: now + (now > 2000 ? 80 : 0),
      latestSnapshotServerTime: latest,
      hasNextSnapshot: false,
      dtMs: 10,
    })!;
    if (previous !== null) {
      expect(render).toBeGreaterThanOrEqual(previous);
      expect(render - previous).toBeLessThanOrEqual(11.001);
      steps.push(render - previous);
    }
    previous = render;
  }
  expect(steps.filter((s) => s === 0).length).toBeLessThan(30);
  expect(clock.bufferLeadMs!).toBeGreaterThan(0);
  expect(clock.bufferLeadMs!).toBeLessThan(400);
  clock.reset();
  expect(clock.renderTime).toBeNull();
});

test("partial snapshot prediction never mutates buffered history", () => {
  const b = new SnapshotBuffer();
  const orb: any = {
    id: "exp",
    name: "exp",
    type: "exp",
    x: 10,
    y: 0,
    vx: 0,
    vy: 0,
    va: 0,
    angle: 0,
  };
  const ship: any = {
    id: "ship",
    name: "ship",
    type: "ship",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    va: 0,
    angle: 0,
    radius: 10,
  };
  b.add({ ...snapshot(1), state: { type: "full", entities: [orb, ship] } });
  b.add({ ...snapshot(2), baseSimTick: 1, state: { type: "partial", updated: [], removed: [] } });
  expect(orb.vx).toBe(0);
  expect(b.getLatest()!.entities.get("exp")!.vx).toBeLessThan(0);
});

test("returning from a suspended tab reanchors forward instead of replaying obsolete history", () => {
  const clock = new PresentationTimingController();
  clock.observeSnapshot(snapshot(20), 1000);
  const before = clock.updateWindow({ predictedServerTime: 1000, latestSnapshotServerTime: 1000, hasNextSnapshot: true, dtMs: 16 })!;
  clock.observeSnapshot(snapshot(220), 11000);
  const after = clock.updateWindow({ predictedServerTime: 11000, latestSnapshotServerTime: 11000, hasNextSnapshot: true, dtMs: 10000 })!;
  expect(after).toBeGreaterThan(before);
  expect(11000 - after).toBeLessThanOrEqual(400);
});
