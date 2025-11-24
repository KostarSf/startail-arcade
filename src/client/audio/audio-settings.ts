/**
 * Audio settings store with localStorage persistence
 */

import { create } from "zustand";
import type { SoundCategory } from "./audio-engine";

const STORAGE_KEY = "audio-settings";

interface AudioSettingsState {
  masterVolume: number;
  volumes: Record<SoundCategory, number>;
  mutes: Record<SoundCategory, boolean>;
}

interface AudioSettingsActions {
  setMasterVolume: (volume: number) => void;
  setVolume: (category: SoundCategory, volume: number) => void;
  setMuted: (category: SoundCategory, muted: boolean) => void;
  load: () => void;
  save: () => void;
}

export type AudioSettingsStore = AudioSettingsState & AudioSettingsActions;

const DEFAULT_SETTINGS: AudioSettingsState = {
  masterVolume: 1.0,
  volumes: {
    game: 1.0,
    ui: 1.0,
    music: 0.8,
    ambience: 1.0,
  },
  mutes: {
    game: false,
    ui: false,
    music: false,
    ambience: false,
  },
};

function loadFromStorage(): Partial<AudioSettingsState> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn("Failed to load audio settings from localStorage:", e);
  }
  return {};
}

function saveToStorage(state: AudioSettingsState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save audio settings to localStorage:", e);
  }
}

export const useAudioSettings = create<AudioSettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  setMasterVolume: (volume: number) => {
    set((state) => {
      const newState = {
        ...state,
        masterVolume: Math.max(0, Math.min(1, volume)),
      };
      // Save the new state immediately
      saveToStorage({
        masterVolume: newState.masterVolume,
        volumes: newState.volumes,
        mutes: newState.mutes,
      });
      return newState;
    });
  },
  setVolume: (category: SoundCategory, volume: number) => {
    set((state) => {
      const newState = {
        ...state,
        volumes: {
          ...state.volumes,
          [category]: Math.max(0, Math.min(1, volume)),
        },
      };
      // Save the new state immediately
      saveToStorage({
        masterVolume: newState.masterVolume,
        volumes: newState.volumes,
        mutes: newState.mutes,
      });
      return newState;
    });
  },
  setMuted: (category: SoundCategory, muted: boolean) => {
    set((state) => {
      const newState = {
        ...state,
        mutes: {
          ...state.mutes,
          [category]: muted,
        },
      };
      // Save the new state immediately
      saveToStorage({
        masterVolume: newState.masterVolume,
        volumes: newState.volumes,
        mutes: newState.mutes,
      });
      return newState;
    });
  },
  load: () => {
    const stored = loadFromStorage();
    set((state) => ({
      masterVolume: stored.masterVolume ?? DEFAULT_SETTINGS.masterVolume,
      volumes: {
        ...DEFAULT_SETTINGS.volumes,
        ...stored.volumes,
      },
      mutes: {
        ...DEFAULT_SETTINGS.mutes,
        ...stored.mutes,
      },
    }));
  },
  save: () => {
    const state = get();
    saveToStorage({
      masterVolume: state.masterVolume,
      volumes: state.volumes,
      mutes: state.mutes,
    });
  },
}));

export const audioSettings = () => useAudioSettings.getState();
