export interface PlayerInputEvent {
  type: "player:input";
  input: {
    accelerating: boolean;
    firing: boolean;
    angle: number;
  };
}

export interface ServerStateEvent {
  type: "server:state";
  entities: {}[];
}

export type NetworkEvent = PlayerInputEvent | ServerStateEvent;
