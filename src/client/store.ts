import type { Container } from "pixi.js";
import { create } from "zustand";

type StatsStoreState = {
  /** The round-trip time of the last ping-pong message */
  latency: number;
  offset: number;
  hasTimeSync: boolean;
  objectsCount: number;
  playerId: string | null;
  playerObject: Container | null;
};

type StatsStoreActions = {
  setLatency: (latency: number) => void;
  setOffset: (offset: number) => void;
  setHasTimeSync: (hasTimeSync: boolean) => void;
  setObjectsCount: (objectsCount: number) => void;
  setPlayerId: (playerId: string) => void;
  setPlayerObject: (playerObject: Container | null) => void;
};

type StatsStore = StatsStoreState & StatsStoreActions;

export const useStats = create<StatsStore>((set) => ({
  latency: 0,
  offset: 0,
  hasTimeSync: false,
  objectsCount: 0,
  playerId: null,
  playerObject: null,
  setLatency: (latency: number) => set({ latency }),
  setOffset: (offset: number) => set({ offset }),
  setHasTimeSync: (hasTimeSync: boolean) => set({ hasTimeSync }),
  setObjectsCount: (objectsCount: number) => set({ objectsCount }),
  setPlayerId: (playerId: string) => set({ playerId }),
  setPlayerObject: (playerObject: Container | null) => set({ playerObject }),
}));

export const stats = () => useStats.getState();
