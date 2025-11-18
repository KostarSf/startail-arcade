import type { Container } from "pixi.js";
import { create } from "zustand";

type StatsStoreState = {
  latency: number;
  offset: number;
  hasTimeSync: boolean;
  playerId: string | null;
  playerObject: Container | null;
};

type StatsStoreActions = {
  setLatency: (latency: number) => void;
  setOffset: (offset: number) => void;
  setHasTimeSync: (hasTimeSync: boolean) => void;
  setPlayerId: (playerId: string) => void;
  setPlayerObject: (playerObject: Container) => void;
};

type StatsStore = StatsStoreState & StatsStoreActions;

export const useStats = create<StatsStore>((set) => ({
  latency: 0,
  offset: 0,
  hasTimeSync: false,
  playerId: null,
  playerObject: null,
  setLatency: (latency: number) => set({ latency }),
  setOffset: (offset: number) => set({ offset }),
  setHasTimeSync: (hasTimeSync: boolean) => set({ hasTimeSync }),
  setPlayerId: (playerId: string) => set({ playerId }),
  setPlayerObject: (playerObject: Container) => set({ playerObject }),
}));

export const stats = () => useStats.getState();
