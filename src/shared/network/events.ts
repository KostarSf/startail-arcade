import type { GenericNetEntityState } from "../game/entities/base";

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
  tickDuration: number;
  state: FullServerState | PartialServerState;
  players: {
    id: string;
    name: string;
    score: number;
    alive: boolean;
  }[];
  radar?: RadarData[];
}

export interface RadarData {
  type: "player" | "ship" | "asteroid";
  x: number;
  y: number;
}

export type FullServerState = {
  type: "full";
  entities: GenericNetEntityState[];
};

export type PartialServerState = {
  type: "partial";
  updated: GenericNetEntityState[];
  removed: string[];
};

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

export interface PlayerLevelUpEvent {
  type: "player:level-up";
  level: number;
  score: number;
  nextLevelScore: number;
}

export interface PlayerCameraBoundsEvent {
  type: "player:camera-bounds";
  viewBounds: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  };
}

export interface PlayerScoreEvent {
  type: "player:score";
  score: number;
  delta: number;
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
  | EntityDestroyEvent
  | PlayerCameraBoundsEvent
  | PlayerScoreEvent
  | PlayerLevelUpEvent;
