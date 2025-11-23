import type { Container } from "pixi.js";

import type {
  ComponentStore,
  EntityId,
  TransformComponent,
  VelocityComponent,
  RenderableComponent,
  ShipControlComponent,
  NetworkStateComponent,
} from "@/shared/ecs";
import type { BaseEntityState } from "@/shared/game/entities/base";
import type { ShipInputCommand } from "@/shared/ecs/components";

import type { Starfield } from "../starfield";
import type { SnapshotBuffer } from "./network/snapshot-buffer";
import type { InputBuffer } from "./network/input-buffer";
import type { CameraShake } from "./systems/camera-shake";
import type { AudioEngine } from "../audio/audio-engine";
import type { StatsStore } from "../store";
import type { AudioSettingsStore } from "../audio/audio-settings";

export interface DamageTextRequest {
  amount: number;
  x: number;
  y: number;
}

export interface ExplosionRequest {
  x: number;
  y: number;
}

export interface ControlState {
  angle: number;
  thrust: boolean;
  fire: boolean;
  staticCamera: boolean;
  cursorScreen: { x: number; y: number } | null;
  cursorWorld: { x: number; y: number } | null;
  lastAnglePacketTime: number;
  lastSentAngle: number;
  pendingAngle: number | null;
  controlMode: "gamepad" | "keyboard" | null;
  gamepadAngle: number | null;
  previousGamepadButtons: boolean[];
  keyboardRotateLeft: boolean;
  keyboardRotateRight: boolean;
  mouseHasMovedSinceKeyboardRotation: boolean;
  lastCursorScreenForMouseCheck: { x: number; y: number } | null;
}

export interface ClientServices extends Record<string, unknown> {
  controls: ControlState;
  snapshotBuffer: SnapshotBuffer;
  inputBuffer: InputBuffer;
  cameraShake: CameraShake;
  entityIndex: Map<string, EntityId>;
  stores: {
    transform: ComponentStore<TransformComponent>;
    velocity: ComponentStore<VelocityComponent>;
    renderable: ComponentStore<RenderableComponent<Container>>;
    shipControl: ComponentStore<ShipControlComponent>;
    networkState: ComponentStore<NetworkStateComponent<BaseEntityState>>;
  };
  pixi: {
    app: import("pixi.js").Application;
    camera: Container;
    starfield: Starfield;
    renderWidth: number;
    renderHeight: number;
  };
  stats: () => StatsStore;
  textures: {
    player: import("pixi.js").Texture;
    playerDamaged1: import("pixi.js").Texture;
    playerDamaged2: import("pixi.js").Texture;
    pirate: import("pixi.js").Texture;
    pirateDamaged1: import("pixi.js").Texture;
    pirateDamaged2: import("pixi.js").Texture;
    asteroids: {
      small: import("pixi.js").Texture[];
      medium: import("pixi.js").Texture[];
      large: import("pixi.js").Texture[];
    };
    bullet: import("pixi.js").Texture;
    glare: import("pixi.js").Texture;
    hint: import("pixi.js").Texture;
    bulletHint: import("pixi.js").Texture;
    explosion: import("pixi.js").Texture;
    jetstream: import("pixi.js").Texture;
    exp1: import("pixi.js").Texture;
    exp2: import("pixi.js").Texture;
    exp3: import("pixi.js").Texture;
  };
  player: {
    id: string | null;
    entityId: EntityId | null;
  };
  network: {
    sendInput: (
      input: {
        thrust: boolean;
        angle: number;
        fire: boolean;
        firingCompensation?: boolean;
        viewBounds?: {
          centerX: number;
          centerY: number;
          width: number;
          height: number;
        };
      },
      options?: { fields?: Array<"thrust" | "angle" | "fire" | "firingCompensation" | "viewBounds"> }
    ) => ShipInputCommand | null;
    sendCameraBounds: (viewBounds: {
      centerX: number;
      centerY: number;
      width: number;
      height: number;
    }) => void;
    predictedServerTime: () => number;
    renderDelayMs: number;
  };
  debug: {
    drawGrid: boolean;
    drawWorldBorder: boolean;
    drawColliders: boolean;
    setDrawGrid: (value: boolean) => void;
    setDrawWorldBorder: (value: boolean) => void;
    setDrawColliders: (value: boolean) => void;
  };
  world: {
    radius: number;
  };
  effectQueues: {
    damageTexts: DamageTextRequest[];
    explosions: ExplosionRequest[];
  };
  effects: {
    queueDamageText: (payload: DamageTextRequest) => void;
    queueExplosion: (payload: ExplosionRequest) => void;
  };
  audio: AudioEngine;
  audioSettings: () => AudioSettingsStore;
}
