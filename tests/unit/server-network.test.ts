import { describe, expect, test } from "bun:test";
import { ServerNetwork } from "../../src/server/engine/server-network";
import { SnapshotBuffer } from "../../src/client/game/network/snapshot-buffer";
import type { ServerStateEvent } from "../../src/shared/network/events";

function harness() {
  let buffered = 0,
    sendResult = 1;
  const messages: ServerStateEvent[] = [];
  const entities: any[] = [];
  const events: any[] = [];
  const world = {
    borderRadius: 50000,
    nonAsteroidEntities: [],
    query: () => ({ array: () => entities.filter((e) => !e.removed) }),
    getReplicatedEventsInRange: (start: number, end: number) =>
      events.filter((e) => e.simTick > start && e.simTick <= end),
    pruneReplicatedEventsThrough: (tick: number) => {
      while (events.length && events[0].simTick <= tick) events.shift();
    },
    clearReplicatedEvents: () => {
      events.length = 0;
    },
  };
  const engine: any = {
    running: true,
    tick: 0,
    serverTime: 0,
    lastTickDuration: 2,
    world,
    debug: { disableCompression: true },
    stop() {
      this.running = false;
    },
    measurePerformance: (_: string, fn: () => unknown) => fn(),
  };
  const network = new ServerNetwork(engine);
  const ws: any = {
    getBufferedAmount: () => buffered,
    close() {},
    send(data: string) {
      const msg = JSON.parse(data);
      if (msg.type === "server:state") {
        if (sendResult !== 0) messages.push(msg);
        return sendResult;
      }
      return 1;
    },
  };
  network.connectPlayer(ws);
  const commit = (tick: number) => {
    engine.tick = tick;
    engine.serverTime = 10000 + tick;
    network.markTickCommitted(tick);
  };
  const entity = (id: string, tick: number, x: number) => ({
    id,
    lastChangedTick: tick,
    removed: false,
    toJSON: () => ({ id, name: id, type: "asteroid", x, y: 0, vx: 0, vy: 0, angle: 0, va: 0 }),
  });
  return {
    network,
    messages,
    entities,
    events,
    commit,
    entity,
    buffer: (v: number) => (buffered = v),
    result: (v: number) => (sendResult = v),
  };
}

describe("snapshot publication", () => {
  test("coalesces catch-up ticks, retains deltas and events, stamps simulation time", () => {
    const h = harness();
    h.entities.push(h.entity("a", 1, 0), h.entity("b", 1, 0));
    h.commit(1);
    h.network.flushCommittedState(0);
    h.entities.splice(1, 1);
    h.entities[0] = h.entity("a", 2, 30);
    h.events.push({
      kind: "entity-destroy",
      entityId: "b",
      x: 0,
      y: 0,
      simTick: 2,
      tickEventIndex: 0,
      replication: "global",
    });
    h.commit(2);
    h.commit(3);
    h.commit(4);
    expect(h.messages.length).toBe(1);
    h.network.flushCommittedState(200);
    expect(h.messages.length).toBe(2);
    expect(h.messages[1]!.serverTime).toBe(200);
    expect(h.messages[1]!.baseSimTick).toBe(1);
    expect(h.messages[1]!.events).toHaveLength(1);
    const client = new SnapshotBuffer();
    for (const msg of h.messages) client.add(msg);
    expect(client.getLatest()!.entities.get("a")!.x).toBe(30);
    expect(client.getLatest()!.entities.has("b")).toBe(false);
    h.commit(5);
    h.network.flushCommittedState(210);
    expect(h.messages).toHaveLength(2);
  });

  test("backpressure retains baseline and events until an accepted send", () => {
    const h = harness();
    h.commit(1);
    h.network.flushCommittedState(0);
    h.buffer(1000);
    h.commit(2);
    h.events.push({
      kind: "player-score",
      playerId: "x",
      score: 5,
      delta: 5,
      simTick: 2,
      tickEventIndex: 0,
      replication: "global",
    });
    h.network.flushCommittedState(50);
    expect(h.messages).toHaveLength(1);
    expect(h.events).toHaveLength(1);
    h.buffer(0);
    h.result(0);
    h.commit(3);
    h.network.flushCommittedState(100);
    expect(h.events).toHaveLength(1);
    h.result(-1);
    h.commit(4);
    h.network.flushCommittedState(150);
    expect(h.messages[1]!.state.type).toBe("full");
    expect(h.messages[1]!.events).toHaveLength(1);
    expect(h.events).toHaveLength(0);
    h.result(1);
    h.commit(5);
    h.network.flushCommittedState(200);
    expect(h.messages[2]!.baseSimTick).toBe(4);
  });

  test("disconnects a stalled peer to bound event retention", () => {
    const h = harness();
    h.commit(1);
    h.network.flushCommittedState(0);
    h.buffer(1000);
    h.commit(202);
    h.network.flushCommittedState(10000);
    expect(h.network.playerCount).toBe(0);
  });
});
