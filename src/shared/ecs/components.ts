import type { BaseEntityState } from "@/shared/game/entities/base";
import type { BulletSpawnState } from "@/shared/game/entities/ship";

export interface TransformComponent {
  x: number;
  y: number;
  angle: number;
}

export interface VelocityComponent {
  vx: number;
  vy: number;
  va: number;
}

export interface ShipInputCommand {
  sequence: number;
  thrust: boolean;
  angle: number;
  fire: boolean;
  timestamp: number;
}

export interface ShipControlComponent {
  thrust: boolean;
  angle: number;
  fire: boolean;
  lastServerSequence: number;
  pendingInputs: ShipInputCommand[];
}

export interface RenderableComponent<TRef = unknown> {
  ref: TRef | null;
  depth: number;
}

export interface SnapshotState<TState = BaseEntityState> {
  serverTime: number;
  state: TState;
}

export interface NetworkStateComponent<TState = BaseEntityState> {
  lastServerTime: number;
  lastSimTick: number;
  predictedServerTime: number;
  renderDelay: number;
  snapshots: SnapshotState<TState>[];
  lastAcknowledgedInput: number;
  state?: TState;
}

export interface PresentationStateComponent {
  wasUsingTail: boolean;
  visualOffsetX: number;
  visualOffsetY: number;
  visualOffsetAngle: number;
}

export interface BulletSpawnComponent {
  pending: BulletSpawnState[];
}
