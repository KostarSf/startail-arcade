import { describe, expect, test } from "bun:test";

import { Asteroid } from "../../src/server/engine/entities/asteroid";
import { ChunkActivityManager } from "../../src/server/engine/world/chunk-activity-manager";
import type { World } from "../../src/server/engine/world/world";

function createFakeWorld(args?: {
  tick?: number;
  borderRadius?: number;
  players?: {
    cameraViewBounds: {
      centerX: number;
      centerY: number;
      width: number;
      height: number;
    } | null;
    ship: null;
  }[];
}) {
  const mutable = {
    borderRadius: args?.borderRadius ?? 5000,
    engine: {
      tick: args?.tick ?? 0,
      network: {
        players: args?.players ?? [],
      },
    },
    updateSpatialIndex() {},
  };

  return {
    world: mutable as unknown as World,
    mutable,
  };
}

describe("ChunkActivityManager", () => {
  test("wakes and sleeps asteroids based on nearby player camera", () => {
    const manager = new ChunkActivityManager();
    const { world, mutable } = createFakeWorld({
      tick: 0,
      players: [],
    });

    manager.initialize(world);

    const asteroid = new Asteroid({
      x: 0,
      y: 0,
      radius: 12,
      maxHealth: 50,
    });
    manager.onSpawn(asteroid);

    expect(manager.isEntitySleeping(asteroid)).toBeTrue();
    expect(Array.from(manager.getActiveAsteroids())).toHaveLength(0);

    mutable.engine.tick = 1;
    mutable.engine.network.players = [
      {
        cameraViewBounds: {
          centerX: 0,
          centerY: 0,
          width: 1000,
          height: 1000,
        },
        ship: null,
      },
    ];

    manager.beginTick(world, 1 / 20);

    expect(manager.isEntitySleeping(asteroid)).toBeFalse();
    expect(Array.from(manager.getActiveAsteroids())).toHaveLength(1);

    mutable.engine.network.players = [];

    for (let tick = 2; tick <= 20; tick++) {
      mutable.engine.tick = tick;
      manager.beginTick(world, 1 / 20);
    }

    expect(manager.isEntitySleeping(asteroid)).toBeFalse();

    mutable.engine.tick = 21;
    manager.beginTick(world, 1 / 20);

    expect(manager.isEntitySleeping(asteroid)).toBeTrue();
    expect(Array.from(manager.getActiveAsteroids())).toHaveLength(0);
  });

  test("wakes chunks across wrapped world borders", () => {
    const manager = new ChunkActivityManager();
    const { world } = createFakeWorld({
      borderRadius: 5000,
      tick: 1,
      players: [
        {
          cameraViewBounds: {
            centerX: 4900,
            centerY: 0,
            width: 1000,
            height: 1000,
          },
          ship: null,
        },
      ],
    });

    manager.initialize(world);

    const asteroid = new Asteroid({
      x: -4900,
      y: 0,
      radius: 12,
      maxHealth: 50,
    });
    manager.onSpawn(asteroid);

    manager.beginTick(world, 1 / 20);

    expect(manager.isEntitySleeping(asteroid)).toBeFalse();
    expect(Array.from(manager.getActiveAsteroids())).toHaveLength(1);
  });

  test("separates overlapping asteroids when a chunk wakes", () => {
    const manager = new ChunkActivityManager();
    const { world } = createFakeWorld({
      tick: 1,
      players: [
        {
          cameraViewBounds: {
            centerX: 0,
            centerY: 0,
            width: 1000,
            height: 1000,
          },
          ship: null,
        },
      ],
    });

    manager.initialize(world);

    const left = new Asteroid({
      x: 0,
      y: 0,
      radius: 20,
      maxHealth: 50,
      vx: 10,
      vy: 5,
      va: 1,
    });
    const right = new Asteroid({
      x: 10,
      y: 0,
      radius: 20,
      maxHealth: 50,
      vx: -3,
      vy: 7,
      va: -2,
    });

    manager.onSpawn(left);
    manager.onSpawn(right);

    manager.beginTick(world, 1 / 20);
    manager.applyWakeStabilization(world);

    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const minDistance = left.radius + right.radius;

    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(minDistance * minDistance);
    expect(left.vx).toBe(10);
    expect(left.vy).toBe(5);
    expect(left.va).toBe(1);
    expect(right.vx).toBe(-3);
    expect(right.vy).toBe(7);
    expect(right.va).toBe(-2);
  });
});
