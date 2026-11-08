import { expect, test } from "bun:test";
import { World } from "../../src/server/engine/world/world";
import { ServerNetwork } from "../../src/server/engine/server-network";
import { Ship } from "../../src/server/engine/entities/ship";

const cases = [
  { name: "ordinary nearby", camera: [100, 0], target: [300, 0], relevant: true },
  { name: "horizontal seam", camera: [49900, 0], target: [-49900, 0], relevant: true },
  { name: "vertical seam", camera: [0, 49900], target: [0, -49900], relevant: true },
  { name: "world corner", camera: [49900, 49900], target: [-49900, -49900], relevant: true },
  { name: "genuinely distant", camera: [0, 0], target: [5000, 0], relevant: false },
];
for (const scenario of cases)
  test(scenario.name, () => {
    const world = new World();
    const messages: any[] = [];
    const engine: any = {
      world,
      running: true,
      tick: 1,
      serverTime: 50,
      lastTickDuration: 1,
      debug: { disableCompression: true },
      measurePerformance: (_: string, fn: () => unknown) => fn(),
    };
    const network = new ServerNetwork(engine);
    engine.network = network;
    world.initialize(engine);
    const ws: any = {
      getBufferedAmount: () => 0,
      close() {},
      send(data: string) {
        const message = JSON.parse(data);
        if (message.type === "server:state") messages.push(message);
        return 1;
      },
    };
    network.connectPlayer(ws);
    network.players[0]!.cameraViewBounds = {
      centerX: scenario.camera[0]!,
      centerY: scenario.camera[1]!,
      width: 1000,
      height: 1000,
    };
    const target = new Ship({ id: "victim", x: scenario.target[0], y: scenario.target[1] });
    world.spawn(target);
    target.initialize(world);
    world.emit({
      kind: "entity-damage",
      replication: "relevant",
      entityId: target.id,
      x: target.x,
      y: target.y,
      amount: 10,
    });
    world.emit({
      kind: "entity-destroy",
      replication: "relevant",
      entityId: target.id,
      x: target.x,
      y: target.y,
    });
    network.markTickCommitted(1);
    network.flushCommittedState(0);
    const frame = messages[0];
    world.clear();
    expect(frame.state.entities.some((e: any) => e.id === target.id)).toBe(scenario.relevant);
    expect(frame.events.map((e: any) => e.kind)).toEqual(
      scenario.relevant ? ["entity-damage", "entity-destroy"] : [],
    );
  });
