import type { Container } from "pixi.js";

import type {
  ComponentStore,
  EntityId,
  TransformComponent,
  VelocityComponent,
  RenderableComponent,
  ShipControlComponent,
  NetworkStateComponent,
  LocalProjectileComponent,
  PredictedComponent,
} from "@/shared/ecs";
import type { BaseEntityState } from "@/shared/game/entities/base";
import type { ShipInputCommand } from "@/shared/ecs/components";

import type { Starfield } from "../starfield";
import type { SnapshotBuffer } from "./network/snapshot-buffer";
import type { InputBuffer } from "./network/input-buffer";
import type { CameraShake } from "./systems/camera-shake";

type StatsStore = ReturnType<typeof import("../store").stats>;

/**
 * Represents the immediate input state from the user (keyboard/mouse).
 */
export interface ControlState {
  angle: number;
  thrust: boolean;
  fire: boolean;
  cursorScreen: { x: number; y: number } | null;
  cursorWorld: { x: number; y: number } | null;
  lastAnglePacketTime: number;
  lastSentAngle: number;
  pendingAngle: number | null;
}

/**
 * Global services available to all ECS systems in the client game loop.
 */
export interface ClientServices extends Record<string, unknown> {
  controls: ControlState;
  snapshotBuffer: SnapshotBuffer;
  inputBuffer: InputBuffer;
  cameraShake: CameraShake;
  /** Map from server entity IDs to local ECS entity IDs. */
  entityIndex: Map<string, EntityId>;
  /** Queue of local projectile entity IDs waiting to be linked to server entities. */
  unlinkedProjectiles: EntityId[];
  stores: {
    transform: ComponentStore<TransformComponent>;
    velocity: ComponentStore<VelocityComponent>;
    renderable: ComponentStore<RenderableComponent<Container>>;
    shipControl: ComponentStore<ShipControlComponent>;
    networkState: ComponentStore<NetworkStateComponent<BaseEntityState>>;
    localProjectile: ComponentStore<LocalProjectileComponent>;
    predicted: ComponentStore<PredictedComponent>;
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
    pirate: import("pixi.js").Texture;
    asteroid: import("pixi.js").Texture;
    bullet: import("pixi.js").Texture;
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
      },
      options?: { fields?: Array<"thrust" | "angle" | "fire"> }
    ) => ShipInputCommand | null;
    predictedServerTime: () => number;
    renderDelayMs: number;
  };
  debug: {
    drawGrid: boolean;
    drawWorldBorder: boolean;
    setDrawGrid: (value: boolean) => void;
    setDrawWorldBorder: (value: boolean) => void;
  };
}
