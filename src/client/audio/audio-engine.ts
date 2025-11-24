/**
 * Audio Engine using Web Audio API
 * Handles positional 2D audio, Doppler effect, reverb, music, and sound categories
 */

// Sound asset imports
import sndClickUrl from "../assets/sounds/snd_click.ogg";
import sndCoinUrl from "../assets/sounds/snd_coin.wav";
import sndDeathUrl from "../assets/sounds/snd_death.wav";
import sndEngineUrl from "../assets/sounds/snd_engine.wav";
import sndExplodeUrl from "../assets/sounds/snd_explode.wav";
import sndFuelUrl from "../assets/sounds/snd_fuel.wav";
import sndHitUrl from "../assets/sounds/snd_hit.wav";
import sndHoverUrl from "../assets/sounds/snd_hover.ogg";
import sndOutOfAmmoUrl from "../assets/sounds/snd_out_of_ammo.wav";
import sndPickEnergyUrl from "../assets/sounds/snd_pick_energy.wav";
import sndReviveUrl from "../assets/sounds/snd_revive.wav";
import sndShootUrl from "../assets/sounds/snd_shoot.wav";
import sndSmallHitUrl from "../assets/sounds/snd_small_hit.wav";
import sndTypeUrl from "../assets/sounds/snd_type.ogg";
import msgSongUrl from "../assets/sounds/music/msc_game_theme_1.ogg";
import spaceAmbienceUrl from "../assets/sounds/music/space.ogg";

export type SoundCategory = "game" | "ui" | "music" | "ambience";

export interface SoundMetadata {
  category: SoundCategory;
  baseVolume: number;
  reverbSend: number; // 0-1, how much goes to reverb
  positional?: boolean; // Can be positional (default true for game sounds)
  dopplerEnabled?: boolean; // Enable Doppler effect (default true for positional sounds)
  basePitch?: number; // Optional base pitch multiplier for looping/one-shot
  dopplerFactor?: number; // Multiplier for Doppler effect sign/strength (default 1: higher when approaching)
}

export interface PlayOneShotParams {
  soundId: string;
  position?: { x: number; y: number };
  velocity?: { vx: number; vy: number };
  volume?: number; // Override base volume (0-1)
  pitch?: number; // Optional pitch multiplier (default 1.0)
}

export interface PlayMusicParams {
  musicId: string;
  loop?: boolean;
  fadeInMs?: number;
  volume?: number;
}

export interface StopMusicParams {
  musicId: string;
  fadeOutMs?: number;
}

// Sound registry with metadata
const SOUND_REGISTRY: Record<string, SoundMetadata> = {
  snd_click: {
    category: "ui",
    baseVolume: 0.5,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_hover: {
    category: "ui",
    baseVolume: 0.3,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_type: {
    category: "ui",
    baseVolume: 0.4,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_explode: {
    category: "game",
    baseVolume: 0.8,
    reverbSend: 0.5,
    positional: true,
    dopplerEnabled: true,
  },
  snd_coin: {
    category: "ui",
    baseVolume: 0.5,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_fuel: {
    category: "ui",
    baseVolume: 0.5,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_pick_energy: {
    category: "ui",
    baseVolume: 0.6,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_death: {
    category: "game",
    baseVolume: 0.8,
    reverbSend: 0.3,
    positional: false, // Center on player
    dopplerEnabled: false,
  },
  snd_engine: {
    category: "game",
    baseVolume: 0.17,
    reverbSend: 0.2,
    positional: true,
    dopplerEnabled: true,
  },
  // Tiny positional engine hum used for enemy bullets
  snd_engine_bullet: {
    category: "game",
    baseVolume: 0.1,
    reverbSend: 0.0,
    positional: true,
    dopplerEnabled: true,
    basePitch: 10,
  },
  snd_hit: {
    category: "game",
    baseVolume: 0.7,
    reverbSend: 0.3,
    positional: true,
    dopplerEnabled: false,
  },
  snd_out_of_ammo: {
    category: "ui",
    baseVolume: 0.6,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_revive: {
    category: "game",
    baseVolume: 0.5,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
  },
  snd_shoot: {
    category: "game",
    baseVolume: 0.5,
    reverbSend: 0.1,
    positional: true,
    dopplerEnabled: true,
  },
  snd_small_hit: {
    category: "game",
    baseVolume: 0.3,
    reverbSend: 0.2,
    positional: true,
    dopplerEnabled: false,
  },
  // Global space ambience, treated as a game sound (non-positional)
  space_ambience: {
    category: "ambience",
    baseVolume: 0.20,
    reverbSend: 0.0,
    positional: false,
    dopplerEnabled: false,
    basePitch: 1.0,
  },
};

// Music registry
const MUSIC_REGISTRY: Record<string, { loop?: boolean; baseVolume: number }> = {
  msg_song: {
    loop: true,
    baseVolume: 0.5,
  },
};

// URL mapping
const SOUND_URLS: Record<string, string> = {
  snd_click: sndClickUrl,
  snd_explode: sndExplodeUrl,
  snd_coin: sndCoinUrl,
  snd_death: sndDeathUrl,
  snd_engine: sndEngineUrl,
  snd_engine_bullet: sndEngineUrl,
  snd_fuel: sndFuelUrl,
  snd_hit: sndHitUrl,
  snd_hover: sndHoverUrl,
  snd_out_of_ammo: sndOutOfAmmoUrl,
  snd_pick_energy: sndPickEnergyUrl,
  snd_revive: sndReviveUrl,
  snd_shoot: sndShootUrl,
  snd_small_hit: sndSmallHitUrl,
  snd_type: sndTypeUrl,
  space_ambience: spaceAmbienceUrl,
};

const MUSIC_URLS: Record<string, string> = {
  msg_song: msgSongUrl,
};

// Effective speed of sound for Doppler calculations (world units per second)
const SOUND_SPEED = 1000;

// Max distance for positional audio (world units)
const MAX_AUDIO_DISTANCE = 2000;

// Reverb parameters
const REVERB_DECAY = 0.8;
const REVERB_DELAY = 0.03;
const REVERB_FEEDBACK = 0.3;

interface ActiveSound {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  reverbSend?: GainNode;
  soundId: string; // Track sound ID for stopping specific sounds
  createdAt: number;
}

interface ActiveMusic {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  isPlaying: boolean;
  fadeStartTime?: number;
  fadeDuration?: number;
  targetVolume?: number;
}

interface LoopingSound {
  soundId: string;
  entityId: string; // Track which entity owns this looping sound
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  panner?: PannerNode;
  position?: { x: number; y: number };
  velocity?: { vx: number; vy: number };
  basePitch: number;
  isPlaying: boolean;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private activeSounds: Set<ActiveSound> = new Set();
  private activeMusic: Map<string, ActiveMusic> = new Map();
  private loopingSounds: Map<string, LoopingSound> = new Map(); // Key: `${soundId}_${entityId}`

  // Category gain nodes
  private gameGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  // Reverb nodes
  private reverbGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;

  // Listener state
  private listenerPosition: { x: number; y: number } = { x: 0, y: 0 };
  private listenerVelocity: { vx: number; vy: number } = { vx: 0, vy: 0 };

  // Category volumes and mutes
  private categoryVolumes: Record<SoundCategory, number> = {
    game: 1.0,
    ui: 1.0,
    music: 1.0,
    ambience: 1.0,
  };
  private categoryMutes: Record<SoundCategory, boolean> = {
    game: false,
    ui: false,
    music: false,
    ambience: false,
  };

  async initialize(): Promise<void> {
    // Create audio context (resume on first user interaction)
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.audioContext.destination);

    // Create category gains
    this.gameGain = this.audioContext.createGain();
    this.gameGain.gain.value = 1.0;
    this.uiGain = this.audioContext.createGain();
    this.uiGain.gain.value = 1.0;
    this.musicGain = this.audioContext.createGain();
    this.musicGain.gain.value = 1.0;
    this.ambienceGain = this.audioContext.createGain();
    this.ambienceGain.gain.value = 1.0;

    // Create reverb send bus
    this.reverbGain = this.audioContext.createGain();
    this.reverbGain.gain.value = 0.5;

    // Create simple algorithmic reverb using delay + feedback
    // For a more realistic reverb, we'd use a convolution reverb with an IR
    const delayNode = this.audioContext.createDelay(0.5);
    delayNode.delayTime.value = REVERB_DELAY;

    const feedbackGain = this.audioContext.createGain();
    feedbackGain.gain.value = REVERB_FEEDBACK;

    const decayGain = this.audioContext.createGain();
    decayGain.gain.value = REVERB_DECAY;

    // Reverb chain: input -> delay -> feedback -> decay -> output
    this.reverbGain.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode); // Feedback loop
    delayNode.connect(decayGain);
    decayGain.connect(this.masterGain);

    // Connect category gains to master
    this.gameGain.connect(this.masterGain);
    this.uiGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.ambienceGain.connect(this.masterGain);

    // Load all sound buffers
    await this.loadBuffers();
  }

  private async loadBuffers(): Promise<void> {
    if (!this.audioContext) return;

    const loadPromises: Promise<void>[] = [];

    // Load sound buffers
    for (const [soundId, url] of Object.entries(SOUND_URLS)) {
      loadPromises.push(
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((arrayBuffer) => this.audioContext!.decodeAudioData(arrayBuffer))
          .then((buffer) => {
            this.buffers.set(soundId, buffer);
          })
          .catch((err) => {
            console.warn(`Failed to load sound ${soundId}:`, err);
          })
      );
    }

    // Load music buffers
    for (const [musicId, url] of Object.entries(MUSIC_URLS)) {
      loadPromises.push(
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((arrayBuffer) => this.audioContext!.decodeAudioData(arrayBuffer))
          .then((buffer) => {
            this.buffers.set(`music_${musicId}`, buffer);
          })
          .catch((err) => {
            console.warn(`Failed to load music ${musicId}:`, err);
          })
      );
    }

    await Promise.all(loadPromises);
  }

  // Resume audio context (required for autoplay policy)
  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  // Update listener position and velocity (called each frame)
  updateListener(position: { x: number; y: number }, velocity: { vx: number; vy: number }): void {
    this.listenerPosition = position;
    this.listenerVelocity = velocity;

    // Update Web Audio API listener position (convert 2D to 3D)
    if (this.audioContext) {
      // Position
      if (this.audioContext.listener.positionX) {
        this.audioContext.listener.positionX.value = position.x;
        this.audioContext.listener.positionY.value = position.y;
        this.audioContext.listener.positionZ.value = 0;
      } else {
        // Fallback for older API
        (this.audioContext.listener as any).setPosition(position.x, position.y, 0);
      }

      // Orientation (facing forward in 2D space)
      if (this.audioContext.listener.forwardX) {
        this.audioContext.listener.forwardX.value = 0;
        this.audioContext.listener.forwardY.value = 0;
        this.audioContext.listener.forwardZ.value = -1;
        this.audioContext.listener.upX.value = 0;
        this.audioContext.listener.upY.value = 1;
        this.audioContext.listener.upZ.value = 0;
      } else {
        // Fallback for older API
        (this.audioContext.listener as any).setOrientation(0, 0, -1, 0, 1, 0);
      }

      // Note: AudioListener doesn't have direct velocity properties
      // Doppler effect is handled through source velocity relative to listener position
      // We store listener velocity for Doppler calculations in playOneShot
    }
  }

  playOneShot(params: PlayOneShotParams): void {
    if (!this.audioContext) return;

    const buffer = this.buffers.get(params.soundId);
    if (!buffer) {
      console.warn(`Sound buffer not found: ${params.soundId}`);
      return;
    }

    const metadata = SOUND_REGISTRY[params.soundId];
    if (!metadata) {
      console.warn(`Sound metadata not found: ${params.soundId}`);
      return;
    }

    // Check if category is muted
    if (this.categoryMutes[metadata.category]) {
      return;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Create gain node for this sound
    const gain = this.audioContext.createGain();
    const volume = params.volume ?? metadata.baseVolume;
    gain.gain.value = volume * this.categoryVolumes[metadata.category];

    // Determine if positional
    const isPositional = metadata.positional !== false && params.position !== undefined;

    let categoryGain: GainNode;
    if (metadata.category === "game") {
      categoryGain = this.gameGain!;
    } else if (metadata.category === "ui") {
      categoryGain = this.uiGain!;
    } else if (metadata.category === "music") {
      categoryGain = this.musicGain!;
    } else if (metadata.category === "ambience") {
      categoryGain = this.ambienceGain!;
    } else {
      categoryGain = this.masterGain!; // Fallback
    }

    let panner: PannerNode | undefined;

    if (isPositional && params.position) {
      // Create panner for positional audio
      panner = this.audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 100;
      panner.maxDistance = MAX_AUDIO_DISTANCE;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      panner.coneOuterGain = 0;

      // Set source position (convert 2D to 3D)
      panner.positionX.value = params.position.x;
      panner.positionY.value = params.position.y;
      panner.positionZ.value = 0;

      // Calculate Doppler shift based on relative velocity
      let finalPlaybackRate = params.pitch ?? 1.0;
      if (params.velocity && metadata.dopplerEnabled !== false) {
        const dx = params.position.x - this.listenerPosition.x;
        const dy = params.position.y - this.listenerPosition.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.1) {
          const dirX = dx / distance;
          const dirY = dy / distance;

          // Relative velocity component along the direction to listener
          // We want relativeVel < 0 when moving away, > 0 when approaching (for intuitive pitch)
          const sourceVel = params.velocity.vx * dirX + params.velocity.vy * dirY;
          const listenerVel = this.listenerVelocity.vx * dirX + this.listenerVelocity.vy * dirY;
          // Flip sign compared to previous version so that approaching gives positive relativeVel
          const relativeVel = listenerVel - sourceVel;

          // Doppler effect: shift playback rate
          // playbackRate = 1 + dopplerFactor * (relativeVel / soundSpeed)
          // Default dopplerFactor = 1: higher when approaching, lower when receding
          const dopplerFactor = metadata.dopplerFactor ?? 1;
          const dopplerShift = 1 + dopplerFactor * (relativeVel / SOUND_SPEED);
          // Multiply pitch with Doppler shift
          finalPlaybackRate *= dopplerShift;
        }
      }
      // Apply pitch/playback rate (clamp to reasonable range)
      source.playbackRate.value = Math.max(0.5, Math.min(2.0, finalPlaybackRate));

      // Connect: source -> gain -> panner -> category gain -> master
      source.connect(gain);
      gain.connect(panner);
      panner.connect(categoryGain);

      // Reverb send if enabled
      if (metadata.reverbSend > 0 && this.reverbGain) {
        const reverbSend = this.audioContext.createGain();
        reverbSend.gain.value = metadata.reverbSend;
        gain.connect(reverbSend);
        reverbSend.connect(this.reverbGain);
      }
    } else {
      // Non-positional audio (centered on listener)
      // Apply pitch if specified (no Doppler for non-positional)
      if (params.pitch !== undefined) {
        source.playbackRate.value = Math.max(0.5, Math.min(2.0, params.pitch));
      }
      source.connect(gain);
      gain.connect(categoryGain);
    }

    // Clean up when sound finishes
    const activeSound: ActiveSound = {
      source,
      gain,
      panner,
      soundId: params.soundId, // Store sound ID for stopping
      createdAt: performance.now(),
    };
    this.activeSounds.add(activeSound);

    source.onended = () => {
      this.activeSounds.delete(activeSound);
      gain.disconnect();
      if (activeSound.panner) {
        activeSound.panner.disconnect();
      }
    };

    source.start(0);
  }

  playMusic(params: PlayMusicParams): void {
    if (!this.audioContext) return;
    if (this.categoryMutes.music) return;

    const buffer = this.buffers.get(`music_${params.musicId}`);
    if (!buffer) {
      console.warn(`Music buffer not found: ${params.musicId}`);
      return;
    }

    const musicInfo = MUSIC_REGISTRY[params.musicId];
    if (!musicInfo) {
      console.warn(`Music metadata not found: ${params.musicId}`);
      return;
    }

    // Stop existing music if playing
    this.stopMusic({ musicId: params.musicId, fadeOutMs: 0 });

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = params.loop ?? musicInfo.loop ?? false;

    const gain = this.audioContext.createGain();
    const volume = params.volume ?? musicInfo.baseVolume;
    gain.gain.value = 0; // Start at 0 for fade in
    gain.connect(this.musicGain!);

    source.connect(gain);
    source.start(0);

    // Fade in
    const fadeInMs = params.fadeInMs ?? 500;
    if (fadeInMs > 0) {
      const fadeInTime = this.audioContext.currentTime + fadeInMs / 1000;
      gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(volume * this.categoryVolumes.music, fadeInTime);
    } else {
      gain.gain.value = volume * this.categoryVolumes.music;
    }

    const activeMusic: ActiveMusic = {
      source,
      gain,
      isPlaying: true,
    };
    this.activeMusic.set(params.musicId, activeMusic);

    // Handle looping: recreate source when it ends
    if (source.loop) {
      source.onended = null; // Loop handles itself
    } else {
      source.onended = () => {
        const music = this.activeMusic.get(params.musicId);
        if (music && music.source === source) {
          this.activeMusic.delete(params.musicId);
        }
      };
    }
  }

  // Play a looping sound for a specific entity
  playLoopingSound(params: {
    soundId: string;
    entityId: string;
    position?: { x: number; y: number };
    velocity?: { vx: number; vy: number };
    nonPositional?: boolean; // If true, sound is centered (non-positional)
    volume?: number;
    pitch?: number; // Optional base pitch multiplier
  }): void {
    if (!this.audioContext) return;

    const buffer = this.buffers.get(params.soundId);
    if (!buffer) {
      console.warn(`Sound buffer not found: ${params.soundId}`);
      return;
    }

    const metadata = SOUND_REGISTRY[params.soundId];
    if (!metadata) {
      console.warn(`Sound metadata not found: ${params.soundId}`);
      return;
    }

    // Check if category is muted
    if (this.categoryMutes[metadata.category]) {
      return;
    }

    const loopKey = `${params.soundId}_${params.entityId}`;

    // Stop existing looping sound for this entity if any
    this.stopLoopingSound(params.soundId, params.entityId);

    // Create new looping sound
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Apply base pitch: explicit param wins, otherwise from registry, fallback 1.0
    const basePitch = params.pitch ?? metadata.basePitch ?? 1.0;
    source.playbackRate.value = basePitch;

    const gain = this.audioContext.createGain();
    const volume = params.volume ?? metadata.baseVolume;
    gain.gain.value = volume * this.categoryVolumes[metadata.category];

    let categoryGain: GainNode;
    if (metadata.category === "game") {
      categoryGain = this.gameGain!;
    } else if (metadata.category === "ui") {
      categoryGain = this.uiGain!;
    } else if (metadata.category === "music") {
      categoryGain = this.musicGain!;
    } else if (metadata.category === "ambience") {
      categoryGain = this.ambienceGain!;
    } else {
      categoryGain = this.masterGain!;
    }

    const isPositional = !params.nonPositional && metadata.positional !== false && params.position !== undefined;
    let panner: PannerNode | undefined;

    if (isPositional && params.position) {
      // Create panner for positional audio
      panner = this.audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 100;
      panner.maxDistance = MAX_AUDIO_DISTANCE;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      panner.coneOuterGain = 0;

      // Set source position
      panner.positionX.value = params.position.x;
      panner.positionY.value = params.position.y;
      panner.positionZ.value = 0;

      // Calculate Doppler shift if enabled
      if (params.velocity && metadata.dopplerEnabled !== false) {
        const dx = params.position.x - this.listenerPosition.x;
        const dy = params.position.y - this.listenerPosition.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.1) {
          const dirX = dx / distance;
          const dirY = dy / distance;
          const sourceVel = params.velocity.vx * dirX + params.velocity.vy * dirY;
          const listenerVel = this.listenerVelocity.vx * dirX + this.listenerVelocity.vy * dirY;
          const relativeVel = sourceVel - listenerVel;
          const dopplerFactor = metadata.dopplerFactor ?? -1;
          const dopplerShift = 1 + dopplerFactor * (relativeVel / SOUND_SPEED);
          source.playbackRate.value = Math.max(0.5, Math.min(2.0, basePitch * dopplerShift));
        }
      }

      source.connect(gain);
      gain.connect(panner);
      panner.connect(categoryGain);

      // Reverb send if enabled
      if (metadata.reverbSend > 0 && this.reverbGain) {
        const reverbSend = this.audioContext.createGain();
        reverbSend.gain.value = metadata.reverbSend;
        gain.connect(reverbSend);
        reverbSend.connect(this.reverbGain);
      }
    } else {
      // Non-positional audio (centered on listener)
      source.connect(gain);
      gain.connect(categoryGain);
    }

    // Store looping sound info
    const loopingSound: LoopingSound = {
      soundId: params.soundId,
      entityId: params.entityId,
      source,
      gain,
      panner,
      position: params.position,
      velocity: params.velocity,
      basePitch,
      isPlaying: true,
    };
    this.loopingSounds.set(loopKey, loopingSound);

    source.start(0);
  }

  // Update looping sound position and velocity
  updateLoopingSound(params: {
    soundId: string;
    entityId: string;
    position?: { x: number; y: number };
    velocity?: { vx: number; vy: number };
  }): void {
    const loopKey = `${params.soundId}_${params.entityId}`;
    const loopingSound = this.loopingSounds.get(loopKey);
    if (!loopingSound || !loopingSound.isPlaying) return;

    if (params.position) {
      loopingSound.position = params.position;
    }
    if (params.velocity) {
      loopingSound.velocity = params.velocity;
    }

    // Update audio nodes if positional
    if (loopingSound.panner && loopingSound.position) {
      loopingSound.panner.positionX.value = loopingSound.position.x;
      loopingSound.panner.positionY.value = loopingSound.position.y;
    }

    // Update Doppler
    const metadata = SOUND_REGISTRY[params.soundId];
    if (
      metadata &&
      metadata.dopplerEnabled !== false &&
      loopingSound.velocity &&
      loopingSound.position &&
      loopingSound.source
    ) {
      const dx = loopingSound.position.x - this.listenerPosition.x;
      const dy = loopingSound.position.y - this.listenerPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.1) {
        const dirX = dx / distance;
        const dirY = dy / distance;
        const sourceVel = loopingSound.velocity.vx * dirX + loopingSound.velocity.vy * dirY;
        const listenerVel = this.listenerVelocity.vx * dirX + this.listenerVelocity.vy * dirY;
        // Flip sign so approaching gives positive relativeVel
        const relativeVel = listenerVel - sourceVel;
        const dopplerFactor = metadata.dopplerFactor ?? 1;
        const dopplerShift = 1 + dopplerFactor * (relativeVel / SOUND_SPEED);
        loopingSound.source.playbackRate.value = Math.max(
          0.5,
          Math.min(2.0, loopingSound.basePitch * dopplerShift)
        );
      }
    }
  }

  // Manually set pitch for a looping sound (used for camera-speed-based ambience)
  setLoopingPitch(params: {
    soundId: string;
    entityId: string;
    pitch: number;
  }): void {
    const loopKey = `${params.soundId}_${params.entityId}`;
    const loopingSound = this.loopingSounds.get(loopKey);
    if (!loopingSound || !loopingSound.source) return;

    loopingSound.basePitch = params.pitch;
    loopingSound.source.playbackRate.value = params.pitch;
  }

  // Stop a looping sound for a specific entity
  stopLoopingSound(soundId: string, entityId: string): void {
    const loopKey = `${soundId}_${entityId}`;
    const loopingSound = this.loopingSounds.get(loopKey);
    if (!loopingSound || !loopingSound.isPlaying) return;

    if (!this.audioContext) return;

    try {
      if (loopingSound.source) {
        loopingSound.source.stop(0);
        loopingSound.source.disconnect();
      }
      loopingSound.gain.disconnect();
      if (loopingSound.panner) {
        loopingSound.panner.disconnect();
      }
    } catch (e) {
      // Ignore errors from already stopped sources
    }

    loopingSound.isPlaying = false;
    loopingSound.source = null;
    this.loopingSounds.delete(loopKey);
  }

  stopMusic(params: StopMusicParams): void {
    const music = this.activeMusic.get(params.musicId);
    if (!music || !music.isPlaying) return;

    if (!this.audioContext) return;

    const fadeOutMs = params.fadeOutMs ?? 500;
    if (fadeOutMs > 0 && music.source) {
      // Fade out
      const fadeOutTime = this.audioContext.currentTime + fadeOutMs / 1000;
      music.gain.gain.cancelScheduledValues(this.audioContext.currentTime);
      music.gain.gain.setValueAtTime(music.gain.gain.value, this.audioContext.currentTime);
      music.gain.gain.linearRampToValueAtTime(0, fadeOutTime);

      // Stop source after fade
      music.source.stop(this.audioContext.currentTime + fadeOutMs / 1000 + 0.1);
    } else {
      // Instant stop
      if (music.source) {
        music.source.stop(0);
        music.source.disconnect();
      }
      music.gain.disconnect();
    }

    music.isPlaying = false;
    music.source = null;
    this.activeMusic.delete(params.musicId);
  }

  // Master volume control
  setMasterVolume(volume: number): void {
    if (!this.masterGain) return;
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  getMasterVolume(): number {
    if (!this.masterGain) return 1.0;
    return this.masterGain.gain.value;
  }

  // Category volume and mute controls
  setCategoryVolume(category: SoundCategory, volume: number): void {
    this.categoryVolumes[category] = Math.max(0, Math.min(1, volume));
    this.updateCategoryGains();
  }

  setCategoryMuted(category: SoundCategory, muted: boolean): void {
    this.categoryMutes[category] = muted;
    this.updateCategoryGains();
  }

  getCategoryVolume(category: SoundCategory): number {
    return this.categoryVolumes[category];
  }

  isCategoryMuted(category: SoundCategory): boolean {
    return this.categoryMutes[category];
  }

  isMusicPlaying(musicId: string): boolean {
    const music = this.activeMusic.get(musicId);
    return music !== undefined && music.isPlaying && music.source !== null;
  }

  private updateCategoryGains(): void {
    if (!this.gameGain || !this.uiGain || !this.musicGain || !this.ambienceGain) return;

    this.gameGain.gain.value = this.categoryMutes.game ? 0 : this.categoryVolumes.game;
    this.uiGain.gain.value = this.categoryMutes.ui ? 0 : this.categoryVolumes.ui;
    this.musicGain.gain.value = this.categoryMutes.music ? 0 : this.categoryVolumes.music;
    this.ambienceGain.gain.value = this.categoryMutes.ambience ? 0 : this.categoryVolumes.ambience;
  }

  // Stop all active sounds with a specific sound ID
  stopAllSoundsWithId(soundId: string): void {
    if (!this.audioContext) return;

    const soundsToStop: ActiveSound[] = [];

    // Find all active sounds with this sound ID
    for (const sound of this.activeSounds) {
      if (sound.soundId === soundId) {
        soundsToStop.push(sound);
      }
    }

    // Stop all matching sounds immediately
    for (const sound of soundsToStop) {
      try {
        sound.source.stop(0);
        sound.gain.disconnect();
        if (sound.panner) {
          sound.panner.disconnect();
        }
        this.activeSounds.delete(sound);
      } catch (e) {
        // Ignore errors from already stopped sources
        this.activeSounds.delete(sound);
      }
    }
  }

  // Clean up
  destroy(): void {
    // Stop all active sounds
    for (const sound of this.activeSounds) {
      try {
        sound.source.stop();
        sound.gain.disconnect();
        if (sound.panner) {
          sound.panner.disconnect();
        }
      } catch (e) {
        // Ignore errors from already stopped sources
      }
    }
    this.activeSounds.clear();

    // Stop all music
    for (const musicId of this.activeMusic.keys()) {
      this.stopMusic({ musicId, fadeOutMs: 0 });
    }

    // Stop all looping sounds
    for (const [loopKey, loopingSound] of this.loopingSounds.entries()) {
      const parts = loopKey.split("_", 2);
      if (parts.length >= 2 && parts[0] && parts[1]) {
        this.stopLoopingSound(parts[0], parts[1]);
      }
    }
    this.loopingSounds.clear();

    // Close audio context
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
    }

    this.audioContext = null;
    this.buffers.clear();
  }
}
