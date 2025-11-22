import type { System } from "@/shared/ecs";
import { AnimatedSprite, Rectangle, Text, Texture } from "pixi.js";

import type {
  ClientServices,
  DamageTextRequest,
  ExplosionRequest,
} from "../types";

interface DamageTextInstance {
  text: Text;
  age: number;
  duration: number;
}

interface ExplosionInstance {
  sprite: AnimatedSprite;
  age: number;
  duration: number;
}

interface EffectRuntimeState {
  damageTexts: DamageTextInstance[];
  explosions: ExplosionInstance[];
  explosionFrames: Texture[];
}

const EFFECT_STATE_KEY = Symbol("effect-state");
const DAMAGE_TEXT_DURATION = 1; // seconds
const DAMAGE_TEXT_SPEED = 18; // pixels per second
const EXPLOSION_DURATION = 0.5; // seconds

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const createExplosionFrames = (baseTexture: Texture) => {
  const frameWidth = baseTexture.width / 4;
  const frameHeight = baseTexture.height;
  const frames: Texture[] = [];
  for (let i = 0; i < 4; i++) {
    frames.push(
      new Texture({
        source: baseTexture.source,
        frame: new Rectangle(i * frameWidth, 0, frameWidth, frameHeight),
      })
    );
  }
  return frames;
};

const spawnDamageText = (
  runtime: EffectRuntimeState,
  services: ClientServices,
  payload: DamageTextRequest
) => {
  const text = new Text({
    text: `-${Math.round(payload.amount)}`,
    style: {
      fill: 0xffff00,
      fontFamily: "Press Start 2P, monospace",
      fontSize: 6,
      dropShadow: {
        distance: 1,
        color: 0x101010,
        angle: Math.PI / 1.5
      }
    },
  });
  text.anchor.set(0.5, 1);
  text.resolution = 2;
  text.roundPixels = true;
  text.x = payload.x;
  text.y = payload.y;
  services.pixi.camera.addChild(text);
  runtime.damageTexts.push({
    text,
    age: 0,
    duration: DAMAGE_TEXT_DURATION,
  });
};

const spawnExplosion = (
  runtime: EffectRuntimeState,
  services: ClientServices,
  payload: ExplosionRequest
) => {
  const sprite = new AnimatedSprite(runtime.explosionFrames);
  sprite.anchor.set(0.5);
  sprite.loop = false;
  const framesPerSecond = runtime.explosionFrames.length / EXPLOSION_DURATION;
  sprite.animationSpeed = framesPerSecond / 60;
  sprite.x = payload.x;
  sprite.y = payload.y;
  sprite.play();
  services.pixi.camera.addChild(sprite);
  runtime.explosions.push({
    sprite,
    age: 0,
    duration: EXPLOSION_DURATION,
  });
};

const updateDamageTexts = (
  runtime: EffectRuntimeState,
  services: ClientServices,
  dt: number
) => {
  for (let i = runtime.damageTexts.length - 1; i >= 0; i--) {
    const instance = runtime.damageTexts[i]!;
    instance.age += dt;
    instance.text.y -= DAMAGE_TEXT_SPEED * dt;
    const alpha = clamp01(1 - instance.age / instance.duration);
    instance.text.alpha = alpha;
    if (instance.age >= instance.duration) {
      services.pixi.camera.removeChild(instance.text);
      instance.text.destroy();
      runtime.damageTexts.splice(i, 1);
    }
  }
};

const updateExplosions = (
  runtime: EffectRuntimeState,
  services: ClientServices,
  dt: number
) => {
  for (let i = runtime.explosions.length - 1; i >= 0; i--) {
    const instance = runtime.explosions[i]!;
    instance.age += dt;
    if (instance.age >= instance.duration) {
      services.pixi.camera.removeChild(instance.sprite);
      instance.sprite.destroy();
      runtime.explosions.splice(i, 1);
    }
  }
};

export const EffectSystem: System<ClientServices> = {
  id: "effect-system",
  stage: "presentation",
  priority: 1,
  init({ services }) {
    const runtime: EffectRuntimeState = {
      damageTexts: [],
      explosions: [],
      explosionFrames: createExplosionFrames(services.textures.explosion),
    };
    (services as any)[EFFECT_STATE_KEY] = runtime;

    services.effectQueues.damageTexts.length = 0;
    services.effectQueues.explosions.length = 0;

    services.effects.queueDamageText = (payload) => {
      services.effectQueues.damageTexts.push(payload);
    };
    services.effects.queueExplosion = (payload) => {
      services.effectQueues.explosions.push(payload);
    };
  },
  tick({ services, dt }) {
    const runtime = (services as any)[EFFECT_STATE_KEY] as
      | EffectRuntimeState
      | undefined;
    if (!runtime) return;

    while (services.effectQueues.damageTexts.length > 0) {
      const payload = services.effectQueues.damageTexts.shift()!;
      spawnDamageText(runtime, services, payload);
    }

    while (services.effectQueues.explosions.length > 0) {
      const payload = services.effectQueues.explosions.shift()!;
      spawnExplosion(runtime, services, payload);
    }

    updateDamageTexts(runtime, services, dt);
    updateExplosions(runtime, services, dt);
  },
};
