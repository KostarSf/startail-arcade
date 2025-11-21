import type { Container } from "pixi.js";
import { create } from "zustand";

type StatsStoreState = {
  /** The round-trip time of the last ping-pong message */
  latency: number;
  offset: number;
  hasTimeSync: boolean;
  objectsCount: number;
  /** Smoothed client-side render FPS */
  fps: number;
  playerId: string | null;
  playerObject: Container | null;
  /** Position where player died (world coordinates) */
  deathPosition: { x: number; y: number } | null;
  /** Leaderboard data */
  players: Array<{
    id: string;
    name: string;
    score: number;
    alive: boolean;
  }>;
  /** Respawn error message */
  respawnError: string | null;
};

type StatsStoreActions = {
  setLatency: (latency: number) => void;
  setOffset: (offset: number) => void;
  setHasTimeSync: (hasTimeSync: boolean) => void;
  setObjectsCount: (objectsCount: number) => void;
  setFps: (fps: number) => void;
  setPlayerId: (playerId: string) => void;
  setPlayerObject: (playerObject: Container | null) => void;
  setDeathPosition: (position: { x: number; y: number } | null) => void;
  setPlayers: (players: Array<{ id: string; name: string; score: number; alive: boolean }>) => void;
  setRespawnError: (error: string | null) => void;
};

type StatsStore = StatsStoreState & StatsStoreActions;

export const useStats = create<StatsStore>((set) => ({
  latency: 0,
  offset: 0,
  hasTimeSync: false,
  objectsCount: 0,
  fps: 0,
  playerId: null,
  playerObject: null,
  deathPosition: null,
  players: [],
  respawnError: null,
  setLatency: (latency: number) => set({ latency }),
  setOffset: (offset: number) => set({ offset }),
  setHasTimeSync: (hasTimeSync: boolean) => set({ hasTimeSync }),
  setObjectsCount: (objectsCount: number) => set({ objectsCount }),
  setFps: (fps: number) => set({ fps }),
  setPlayerId: (playerId: string) => set({ playerId }),
  setPlayerObject: (playerObject: Container | null) => set({ playerObject }),
  setDeathPosition: (position: { x: number; y: number } | null) => set({ deathPosition: position }),
  setPlayers: (players: Array<{ id: string; name: string; score: number; alive: boolean }>) => set({ players }),
  setRespawnError: (error: string | null) => set({ respawnError: error }),
}));

export const stats = () => useStats.getState();
