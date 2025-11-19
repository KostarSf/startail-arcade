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

type StatsStore = ReturnType<typeof import("../store").stats>;

export interface ControlState {
  angle: number;
  thrust: boolean;
  fire: boolean;
  cursorScreen: { x: number; y: number } | null;
  cursorWorld: { x: number; y: number } | null;
}

export interface ClientServices extends Record<string, unknown> {
  controls: ControlState;
  snapshotBuffer: SnapshotBuffer;
  inputBuffer: InputBuffer;
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
    pirate: import("pixi.js").Texture;
    asteroid: import("pixi.js").Texture;
    bullet: import("pixi.js").Texture;
  };
  player: {
    id: string | null;
    entityId: EntityId | null;
  };
  network: {
    sendInput: (input: {
      thrust: boolean;
      angle: number;
      fire: boolean;
    }) => ShipInputCommand | null;
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
