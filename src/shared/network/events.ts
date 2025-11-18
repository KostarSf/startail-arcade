export interface PlayerInputEvent {
  type: "player:input";
  input: {
    accelerating?: boolean;
    firing?: boolean;
    angle?: number;
  };
}

export interface PlayerSetIdEvent {
  type: "player:set-id";
  id: string;
}

export interface ServerStateEvent {
  type: "server:state";
  entities: {
    type: string;
    id: string;
    x: number;
    y: number;
    angle: number;
    vx: number;
    vy: number;
    accelerating?: boolean;
    life?: number;
  }[];
}

export type NetworkEvent =
  | PlayerInputEvent
  | ServerStateEvent
  | PlayerSetIdEvent;
