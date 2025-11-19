import type { BaseEntityState } from "@/shared/game/entities/base";
import type { BulletSpawnState } from "@/shared/game/entities/ship";

/**
 * Represents the spatial state of an entity in the world.
 */
export interface TransformComponent {
  x: number;
  y: number;
  angle: number;
}

/**
 * Represents the linear and angular velocity of an entity.
 */
export interface VelocityComponent {
  vx: number;
  vy: number;
  va: number;
}

/**
 * A single input command sent from the client to the server.
 */
export interface ShipInputCommand {
  sequence: number;
  thrust: boolean;
  angle: number;
  fire: boolean;
  timestamp: number;
}

/**
 * Manages the ship's control state, including inputs and server reconciliation data.
 */
export interface ShipControlComponent {
  thrust: boolean;
  angle: number;
  fire: boolean;
  lastServerSequence: number;
  pendingInputs: ShipInputCommand[];
}

/**
 * Wrapper for a PIXI container or similar renderable object.
 */
export interface RenderableComponent<TRef = unknown> {
  ref: TRef | null;
  depth: number;
}

/**
 * A snapshot of an entity's state at a specific server time.
 */
export interface SnapshotState<TState = BaseEntityState> {
  serverTime: number;
  state: TState;
}

/**
 * Stores historical server snapshots and interpolation/reconciliation state for networked entities.
 */
export interface NetworkStateComponent<TState = BaseEntityState> {
  lastServerTime: number;
  predictedServerTime: number;
  renderDelay: number;
  snapshots: SnapshotState<TState>[];
  lastAcknowledgedInput: number;
  state?: TState;
}

/**
 * Tracks pending bullet spawns from ship actions.
 */
export interface BulletSpawnComponent {
  pending: BulletSpawnState[];
}

/**
 * Identifies a projectile spawned locally by the client, before server confirmation.
 */
export interface LocalProjectileComponent {
  spawnTime: number;
  ownerId: string;
  serverId?: string;
}

/**
 * Tag component indicating an entity is predicted on the client (e.g., local ship, local bullets).
 */
export interface PredictedComponent {
  // Tag component to mark entity for client-side prediction
}
