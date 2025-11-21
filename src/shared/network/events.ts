import type { EntityType } from "../game/entities/base";

export interface PlayerInputEvent {
  type: "player:input";
  sequence: number;
  /** Round trip time in milliseconds */
  latency: number;
  input: {
    thrust?: boolean;
    angle?: number;
    fire?: boolean;
    firingCompensation?: boolean;
  };
}

export interface PlayerSetIdEvent {
  type: "server:player-initialize";
  playerId: string;
  tps: number;
  worldRadius: number;
}

export interface PlayerRespawnEvent {
  type: "player:respawn";
  name: string;
}

export interface ServerRespawnDeniedEvent {
  type: "server:respawn-denied";
  reason: string;
}

export interface PlayerPingEvent {
  type: "player:ping";
  sequence: number;
  clientTime: number;
}

export interface ServerPongEvent {
  type: "server:pong";
  sequence: number;
  clientTime: number;
  serverTime: number;
}

export interface ServerStateEvent {
  type: "server:state";
  serverTime: number;
  entities: {
    name: string;
    type: EntityType;
    id: string;
    x: number;
    y: number;
    angle: number;
    vx: number;
    vy: number;
    va?: number;
    radius?: number;
    thrust?: boolean;
    lastInputSequence?: number;
    health?: number;
    maxHealth?: number;
    energy?: number;
    maxEnergy?: number;
  }[];
  players: {
    id: string;
    name: string;
    score: number;
    alive: boolean;
  }[];
}

export interface EntityDamageEvent {
  type: "entity:damage";
  entityId: string;
  amount: number;
  x: number;
  y: number;
  sourceId?: string;
}

export interface EntityDestroyEvent {
  type: "entity:destroy";
  entityId: string;
  x: number;
  y: number;
  sourceId?: string;
  playerId?: string;
  score?: number;
}

export type NetworkEvent =
  | PlayerInputEvent
  | ServerStateEvent
  | PlayerSetIdEvent
  | PlayerPingEvent
  | ServerPongEvent
  | PlayerRespawnEvent
  | ServerRespawnDeniedEvent
  | EntityDamageEvent
  | EntityDestroyEvent;
