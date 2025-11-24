import type { RadarData } from "@/shared/network/events";
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
  /** Radar data */
  radarData: Array<RadarData> | null;
  /** World radius for radar calculations */
  worldRadius: number;
  /** Last server tick duration in milliseconds */
  tickDuration: number;
  /** Connection error state */
  connectionError: boolean;
  /** Reconnecting state - true when attempting to reconnect */
  isReconnecting: boolean;
  /** Network traffic stats in KB per second */
  inboundBytesPerSecond: number;
  outboundBytesPerSecond: number;
  /** Floating score texts */
  floatingScoreTexts: Array<{
    id: number;
    value: number;
    startTime: number;
  }>;
  /** Remove floating score text by id */
  removeFloatingScoreText: (id: number) => void;
};

type StatsStoreActions = {
  setLatency: (latency: number) => void;
  setOffset: (offset: number) => void;
  setHasTimeSync: (hasTimeSync: boolean) => void;
  setObjectsCount: (objectsCount: number) => void;
  setFps: (fps: number) => void;
  setPlayerId: (playerId: string | null) => void;
  setPlayerObject: (playerObject: Container | null) => void;
  setDeathPosition: (position: { x: number; y: number } | null) => void;
  setPlayers: (players: Array<{ id: string; name: string; score: number; alive: boolean }>) => void;
  setRespawnError: (error: string | null) => void;
  setRadarData: (data: Array<RadarData> | null) => void;
  setWorldRadius: (radius: number) => void;
  setTickDuration: (tickDuration: number) => void;
  setConnectionError: (error: boolean) => void;
  setIsReconnecting: (isReconnecting: boolean) => void;
  setInboundBytes: (bytesPerSecond: number) => void;
  setOutboundBytes: (bytesPerSecond: number) => void;
  addFloatingScoreText: (value: number) => void;
  removeFloatingScoreText: (id: number) => void;
};

export type StatsStore = StatsStoreState & StatsStoreActions;

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
  radarData: null,
  worldRadius: 5000,
  tickDuration: 0,
  connectionError: false,
  isReconnecting: false,
  inboundBytesPerSecond: 0,
  outboundBytesPerSecond: 0,
  floatingScoreTexts: [],
  setLatency: (latency: number) => set({ latency }),
  setOffset: (offset: number) => set({ offset }),
  setHasTimeSync: (hasTimeSync: boolean) => set({ hasTimeSync }),
  setObjectsCount: (objectsCount: number) => set({ objectsCount }),
  setFps: (fps: number) => set({ fps }),
  setPlayerId: (playerId: string| null) => set({ playerId }),
  setPlayerObject: (playerObject: Container | null) => set({ playerObject }),
  setDeathPosition: (position: { x: number; y: number } | null) => set({ deathPosition: position }),
  setPlayers: (players: Array<{ id: string; name: string; score: number; alive: boolean }>) => set({ players }),
  setRespawnError: (error: string | null) => set({ respawnError: error }),
  setRadarData: (data: Array<RadarData> | null) => set({ radarData: data }),
  setWorldRadius: (radius: number) => set({ worldRadius: radius }),
  setTickDuration: (tickDuration: number) => set({ tickDuration }),
  setConnectionError: (error: boolean) => set({ connectionError: error }),
  setIsReconnecting: (isReconnecting: boolean) => set({ isReconnecting }),
  setInboundBytes: (bytesPerSecond: number) => set({ inboundBytesPerSecond: bytesPerSecond }),
  setOutboundBytes: (bytesPerSecond: number) => set({ outboundBytesPerSecond: bytesPerSecond }),
  addFloatingScoreText: (value: number) =>
    set((state) => ({
      floatingScoreTexts: [
        ...state.floatingScoreTexts,
        {
          id: Date.now() + Math.random(),
          value,
          startTime: performance.now(),
        },
      ],
    })),
  removeFloatingScoreText: (id: number) =>
    set((state) => ({
      floatingScoreTexts: state.floatingScoreTexts.filter((text) => text.id !== id),
    })),
}));

export const stats = () => useStats.getState();
