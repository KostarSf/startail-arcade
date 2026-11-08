import { expect, test } from "bun:test";
import { Container, Texture } from "pixi.js";
import { EffectSystem } from "../../src/client/game/systems/effect-system";

test("live effects follow the nearest camera image without resetting age or text drift", () => {
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const camera = new Container();
  const services: any = {
    pixi: { camera, renderWidth: 1280, renderHeight: 720 },
    world: { radius: 50000 },
    textures: { explosion: Texture.EMPTY },
    effects: {},
    effectQueues: { damageTexts: [], explosions: [] },
  };
  try {
    camera.position.set(640 - 49900, 360 - 49900);
    EffectSystem.init!({ services } as any);
    services.effects.queueDamageText({ x: -49900, y: -49900, amount: 17 });
    services.effects.queueExplosion({ x: -49900, y: -49900 });
    EffectSystem.tick({ services, dt: 0 } as any);
    const text = camera.children.find((c) => c.label === "world-damage-text")!;
    const explosion = camera.children.find((c) => c.label === "world-explosion")!;
    expect(text.x).toBe(50100);
    expect(text.y).toBe(50100);
    expect(explosion.x).toBe(50100);
    expect(explosion.y).toBe(50100);
    camera.position.set(640 + 49950, 360 + 49950);
    EffectSystem.tick({ services, dt: 0.2 } as any);
    expect(text.x).toBe(-49900);
    expect(text.y).toBeCloseTo(-49903.6);
    expect(explosion.x).toBe(-49900);
    expect(explosion.y).toBe(-49900);
    expect(text.alpha).toBeCloseTo(0.8);
    // Crossing back does not keep either effect alive or reset its drift.
    camera.position.set(640 - 49900, 360 - 49900);
    EffectSystem.tick({ services, dt: 0.31 } as any);
    expect(explosion.destroyed).toBeTrue();
    expect(text.x).toBe(50100);
    expect(text.y).toBeCloseTo(50100 - 0.51 * 18);
    EffectSystem.tick({ services, dt: 0.5 } as any);
    expect(camera.children).toHaveLength(0);
  } finally {
    camera.destroy({ children: true });
    globalThis.requestAnimationFrame = previousRAF;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
