export interface PlayerInputEvent {
  type: "player:input";
  sequence: number;
  input: {
    thrust?: boolean;
    angle?: number;
    fire?: boolean;
  };
}

export interface PlayerSetIdEvent {
  type: "server:player-initialize";
  playerId: string;
  tps: number;
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
    type: string;
    id: string;
    x: number;
    y: number;
    angle: number;
    vx: number;
    vy: number;
    va?: number;
    thrust?: boolean;
    lastInputSequence?: number;
    life?: number;
  }[];
}

export type NetworkEvent =
  | PlayerInputEvent
  | ServerStateEvent
  | PlayerSetIdEvent
  | PlayerPingEvent
  | ServerPongEvent;
