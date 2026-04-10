import {
  Application,
  Assets,
  Container,
  RenderTexture,
  Sprite,
  Texture,
  Ticker,
} from "pixi.js";

import {
  ComponentStore,
  EntityManager,
  Pipeline,
  type EntityId,
} from "@/shared/ecs";
import type {
  NetworkStateComponent,
  RenderableComponent,
  ShipControlComponent,
  ShipInputCommand,
  TransformComponent,
  VelocityComponent,
} from "@/shared/ecs/components";
import type { BaseEntityState } from "@/shared/game/entities/base";
import type { NetworkEvent, PlayerInputEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";

import asteroidLarge1TextureSrc from "../assets/images/asteroids/large-01.png";
import asteroidLarge2TextureSrc from "../assets/images/asteroids/large-02.png";
import asteroidMedium1TextureSrc from "../assets/images/asteroids/medium-01.png";
import asteroidMedium2TextureSrc from "../assets/images/asteroids/medium-02.png";
import asteroidSmall1TextureSrc from "../assets/images/asteroids/small-01.png";
import asteroidSmall2TextureSrc from "../assets/images/asteroids/small-02.png";

import bulletHintTextureSrc from "../assets/images/bullet-hint.png";
import bulletTextureSrc from "../assets/images/bullet.png";
import exp1TextureSrc from "../assets/images/exp-1.png";
import exp2TextureSrc from "../assets/images/exp-2.png";
import exp3TextureSrc from "../assets/images/exp-3.png";
import explosionTextureSrc from "../assets/images/explosion.png";
import glareTextureSrc from "../assets/images/glare.png";
import hintBwTextureSrc from "../assets/images/hint_bw.png";
import jetstreamTextureSrc from "../assets/images/jetstream.png";
import pirateDamaged1TextureSrc from "../assets/images/pirate-damaged-1.png";
import pirateDamaged2TextureSrc from "../assets/images/pirate-damaged-2.png";
import pirateTextureSrc from "../assets/images/pirate.png";
import playerDamaged1TextureSrc from "../assets/images/player-damaged-1.png";
import playerDamaged2TextureSrc from "../assets/images/player-damaged-2.png";
import playerTextureSrc from "../assets/images/player.png";

import { Starfield } from "../starfield";
import { stats } from "../store";
import { AudioEngine } from "../audio/audio-engine";
import { audioSettings } from "../audio/audio-settings";
import { isDevelopmentClient } from "../dev-mode";
import { InputBuffer } from "./network/input-buffer";
import { NetworkDecoder } from "./network/network-decoder";
import { SnapshotBuffer } from "./network/snapshot-buffer";
import { EdgeOfWorldFilter } from "./shaders/edge-of-world-filter";
import { CameraShake } from "./systems/camera-shake";
import { CameraSystem } from "./systems/camera-system";
import { EffectSystem } from "./systems/effect-system";
import { GridSystem } from "./systems/grid-system";
import { HintSystem } from "./systems/hint-system";
import { InputSystem } from "./systems/input-system";
import { InterpolationSystem } from "./systems/interpolation-system";
import { ParticleSystem } from "./systems/particle-system";
import { ReconciliationSystem } from "./systems/reconciliation-system";
import { RenderSystem } from "./systems/render-system";
import { AudioSystem } from "./systems/audio-system";
import type {
  ClientServices,
  ControlState,
  DamageTextRequest,
  ExplosionRequest,
} from "./types";

const RENDER_DELAY_MS = 100;
const SNAPSHOT_TIMING_SAMPLE_SIZE = 30;
const SNAPSHOT_TIMING_MIN_SAMPLES = 5;
const SNAPSHOT_TIMING_WARN_FACTOR = 1.5;
const SNAPSHOT_TIMING_WARN_MIN_DELTA_MS = 8;

export class ClientEngine {
  #app: Application;
  #camera = new Container();
  #starfield = new Starfield(500, 10000, 10000, 0.3);
  #statsGetter = stats;
  #gameContainer = new Container();
  #renderTexture: RenderTexture | null = null;
  #renderSprite: Sprite | null = null;
  #edgeOfWorldFilter: EdgeOfWorldFilter | null = null;
  #renderScale = 0.7;
  #lastScreenWidth = 0;
  #lastScreenHeight = 0;
  #audioEngine: AudioEngine | null = null;

  #entityManager = new EntityManager();
  #pipeline: Pipeline<ClientServices> | null = null;

  #transformStore = new ComponentStore<TransformComponent>(this.#entityManager);
  #velocityStore = new ComponentStore<VelocityComponent>(this.#entityManager);
  #renderableStore = new ComponentStore<RenderableComponent<Container>>(
    this.#entityManager
  );
  #shipControlStore = new ComponentStore<ShipControlComponent>(
    this.#entityManager
  );
  #networkStateStore = new ComponentStore<
    NetworkStateComponent<BaseEntityState>
  >(this.#entityManager);

  #snapshotBuffer = new SnapshotBuffer();
  #inputBuffer = new InputBuffer();
  #cameraShake = new CameraShake();
  #entityIndex = new Map<string, EntityId>();
  #controls: ControlState = {
    angle: 0,
    thrust: false,
    fire: false,
    staticCamera: false,
    cursorScreen: null,
    cursorWorld: null,
    lastAnglePacketTime: 0,
    lastSentAngle: 0,
    pendingAngle: null,
    controlMode: null,
    gamepadAngle: null,
    previousGamepadButtons: [],
    keyboardRotateLeft: false,
    keyboardRotateRight: false,
    mouseHasMovedSinceKeyboardRotation: true,
    lastCursorScreenForMouseCheck: null,
  };

  #services: ClientServices | null = null;

  #textures: {
    player: Texture | null;
    playerDamaged1: Texture | null;
    playerDamaged2: Texture | null;
    pirate: Texture | null;
    pirateDamaged1: Texture | null;
    pirateDamaged2: Texture | null;
    asteroids: {
      small: Texture[];
      medium: Texture[];
      large: Texture[];
    };
    bullet: Texture | null;
    glare: Texture | null;
    hint: Texture | null;
    bulletHint: Texture | null;
    explosion: Texture | null;
    jetstream: Texture | null;
    exp1: Texture | null;
    exp2: Texture | null;
    exp3: Texture | null;
  } = {
    player: null,
    playerDamaged1: null,
    playerDamaged2: null,
    pirate: null,
    pirateDamaged1: null,
    pirateDamaged2: null,
    asteroids: { small: [], medium: [], large: [] },
    bullet: null,
    glare: null,
    hint: null,
    bulletHint: null,
    explosion: null,
    jetstream: null,
    exp1: null,
    exp2: null,
    exp3: null,
  };

  #ws: WebSocket | null = null;
  #connectTimeout: ReturnType<typeof setTimeout> | null = null;
  #inputSequence = 0;
  #pingSequence = 0;
  #pingTicker = new Ticker();
  #networkStatsTicker = new Ticker();
  #inboundBytes = 0;
  #outboundBytes = 0;
  #simulatedLatencyMs = 0;
  #drawGrid = false;
  #drawWorldBorder = false;
  #drawColliders = false;
  #disableInterpolation = false;
  #disableReconciliation = false;
  #fpsSampleFrames = 0;
  #fpsLastSampleTime = 0;
  #connectionAttempts = 0;
  #maxConnectionAttempts = 5;
  #snapshotTimingDebugEnabled = false;
  #snapshotArrivalIntervalsMs: number[] = [];
  #lastSnapshotArrivalTimeMs: number | null = null;

  #networkDecoder: NetworkDecoder;

  get simulatedLatencyMs() {
    return this.#simulatedLatencyMs;
  }

  constructor() {
    this.#app = new Application();
    this.#simulatedLatencyMs = this.#resolveSimulatedLatency();
    if (this.#simulatedLatencyMs > 0) {
      console.info(
        `[net] Using simulated latency: ${this.#simulatedLatencyMs}ms`
      );
    }
    // Initialize debug settings from URL params
    this.#drawWorldBorder = this.#resolveWorldBorderFromURL();
    this.#drawGrid = this.#resolveDrawGridFromURL();
    this.#drawColliders = this.#resolveDrawCollidersFromURL();
    this.#disableInterpolation = this.#resolveDisableInterpolationFromURL();
    this.#disableReconciliation = this.#resolveDisableReconciliationFromURL();
    this.#snapshotTimingDebugEnabled =
      this.#resolveSnapshotTimingDebugFromURL();

    this.#networkDecoder = new NetworkDecoder(this);
  }

  #isDevelopmentEnvironment(): boolean {
    return isDevelopmentClient();
  }

  #resolveBooleanFlagFromURL(paramName: string): boolean {
    if (typeof window === "undefined") return false;
    const value = new URLSearchParams(window.location.search).get(paramName);
    return value === "true" || value === "1" || value === "on";
  }

  #resolveWorldBorderFromURL(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("world-border") === "true";
  }

  #resolveAgentModeFromURL(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("agent-mode") === "true";
  }

  #resolveAudioDisabledFromURL(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const audioParam = params.get("audio");
    if (audioParam === "off" || audioParam === "false" || audioParam === "0") {
      return true;
    }

    return this.#resolveAgentModeFromURL();
  }

  #resolveDrawGridFromURL(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const gridParam = params.get("draw-grid");
    if (gridParam === null) return false; // Default to false (disabled) when param is missing
    return gridParam === "true";
  }

  #resolveDrawCollidersFromURL(): boolean {
    if (typeof window === "undefined") return false;
    return this.#resolveBooleanFlagFromURL("draw-colliders");
  }

  #resolveDisableInterpolationFromURL(): boolean {
    if (!this.#isDevelopmentEnvironment()) return false;
    return this.#resolveBooleanFlagFromURL("disable-interpolation");
  }

  #resolveDisableReconciliationFromURL(): boolean {
    if (!this.#isDevelopmentEnvironment()) return false;
    return this.#resolveBooleanFlagFromURL("disable-reconciliation");
  }

  #resolveSnapshotTimingDebugFromURL(): boolean {
    return (
      this.#resolveBooleanFlagFromURL("debug-snapshot-timing") ||
      this.#resolveAgentModeFromURL() ||
      this.#isDevelopmentEnvironment()
    );
  }

  setDrawGrid(value: boolean) {
    this.#drawGrid = value;
    // Update URL param
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) {
        url.searchParams.set("draw-grid", "true");
      } else {
        url.searchParams.set("draw-grid", "false");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  setDrawWorldBorder(value: boolean) {
    this.#drawWorldBorder = value;
    // Update URL param
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) {
        url.searchParams.set("world-border", "true");
      } else {
        url.searchParams.delete("world-border");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  setDrawColliders(value: boolean) {
    this.#drawColliders = value;
    // Update URL param
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) {
        url.searchParams.set("draw-colliders", "true");
      } else {
        url.searchParams.set("draw-colliders", "false");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  setDisableInterpolation(value: boolean) {
    if (!this.#isDevelopmentEnvironment()) {
      this.#disableInterpolation = false;
      return;
    }

    this.#disableInterpolation = value;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) {
        url.searchParams.set("disable-interpolation", "true");
      } else {
        url.searchParams.delete("disable-interpolation");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  setDisableReconciliation(value: boolean) {
    if (!this.#isDevelopmentEnvironment()) {
      this.#disableReconciliation = false;
      return;
    }

    this.#disableReconciliation = value;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) {
        url.searchParams.set("disable-reconciliation", "true");
      } else {
        url.searchParams.delete("disable-reconciliation");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  getSimulatedLatency(): number {
    return this.#simulatedLatencyMs;
  }

  setSimulatedLatency(ms: number) {
    this.#simulatedLatencyMs = Math.max(0, ms);
  }

  getDrawGrid(): boolean {
    return this.#drawGrid;
  }

  getDrawWorldBorder(): boolean {
    return this.#drawWorldBorder;
  }

  getDrawColliders(): boolean {
    return this.#drawColliders;
  }

  getDisableInterpolation(): boolean {
    return this.#disableInterpolation;
  }

  getDisableReconciliation(): boolean {
    return this.#disableReconciliation;
  }

  isConnected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  setDebugOptions(options: {
    drawGrid?: boolean;
    drawWorldBorder?: boolean;
    drawColliders?: boolean;
    simulatedLatencyMs?: number;
    disableInterpolation?: boolean;
    disableReconciliation?: boolean;
  }) {
    if (options.drawGrid !== undefined) {
      this.setDrawGrid(options.drawGrid);
    }
    if (options.drawWorldBorder !== undefined) {
      this.setDrawWorldBorder(options.drawWorldBorder);
    }
    if (options.drawColliders !== undefined) {
      this.setDrawColliders(options.drawColliders);
    }
    if (options.simulatedLatencyMs !== undefined) {
      this.setSimulatedLatency(options.simulatedLatencyMs);
    }
    if (options.disableInterpolation !== undefined) {
      this.setDisableInterpolation(options.disableInterpolation);
    }
    if (options.disableReconciliation !== undefined) {
      this.setDisableReconciliation(options.disableReconciliation);
    }
  }

  getRuntimeSnapshot() {
    const currentStats = this.#statsGetter();
    const activePlayer = currentStats.playerId
      ? currentStats.players.find((player) => player.id === currentStats.playerId)
      : null;
    const playerAlive = currentStats.playerObject !== null || activePlayer?.alive === true;

    return {
      connected: this.isConnected(),
      connectionAttempts: this.#connectionAttempts,
      reconnecting: currentStats.isReconnecting,
      simulatedLatencyMs: this.#simulatedLatencyMs,
      debug: {
        drawGrid: this.#drawGrid,
        drawWorldBorder: this.#drawWorldBorder,
        drawColliders: this.#drawColliders,
        disableInterpolation: this.#disableInterpolation,
        disableReconciliation: this.#disableReconciliation,
      },
      player: {
        id: currentStats.playerId,
        alive: playerAlive,
        x:
          currentStats.playerObject !== null
            ? Math.round(currentStats.playerObject.x * 10) / 10
            : null,
        y:
          currentStats.playerObject !== null
            ? Math.round(currentStats.playerObject.y * 10) / 10
            : null,
        rotation:
          currentStats.playerObject !== null
            ? Math.round(currentStats.playerObject.rotation * 1000) / 1000
            : null,
      },
      stats: {
        latency: Math.round(currentStats.latency * 100) / 100,
        offset: Math.round(currentStats.offset * 100) / 100,
        hasTimeSync: currentStats.hasTimeSync,
        objectsCount: currentStats.objectsCount,
        fps: Math.round(currentStats.fps * 10) / 10,
        tickDuration: Math.round(currentStats.tickDuration * 100) / 100,
        connectionError: currentStats.connectionError,
        inboundBytesPerSecond:
          Math.round(currentStats.inboundBytesPerSecond * 100) / 100,
        outboundBytesPerSecond:
          Math.round(currentStats.outboundBytesPerSecond * 100) / 100,
        leaderboard: currentStats.players.map((player) => ({
          id: player.id,
          name: player.name,
          score: player.score,
          alive: player.alive,
        })),
        respawnError: currentStats.respawnError,
        worldRadius: currentStats.worldRadius,
        radarCount: currentStats.radarData?.length ?? 0,
      },
    };
  }

  sendInputForTest(input: {
    thrust: boolean;
    angle: number;
    fire: boolean;
    firingCompensation?: boolean;
  }) {
    return this.#sendInput(input, {
      fields: ["thrust", "angle", "fire", "firingCompensation"],
    });
  }

  async initialize(parent: HTMLElement) {
    if (this.#resolveAgentModeFromURL()) {
      console.info("[agent] using headless client mode");
      this.#audioEngine = new AudioEngine();
      this.#setupTickers();
      this.#connect();
      return;
    }

    await this.#app.init({
      background: "#000000",
      resizeTo: window,
      antialias: false,
      resolution: 1,
    });

    parent.appendChild(this.#app.canvas);
    // Disable CSS-level antialiasing for pixelated retro look
    const canvas = this.#app.canvas;
    canvas.style.imageRendering = "pixelated";
    canvas.style.setProperty(
      "image-rendering",
      "-moz-crisp-edges",
      "important"
    );
    canvas.style.setProperty("image-rendering", "crisp-edges", "important");

    // Disable right-click context menu
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Set up retro rendering: render game at 0.75x resolution
    this.#setupRetroRendering();

    this.#app.stage.eventMode = "static";
    this.#app.stage.hitArea = this.#app.screen;

    // Ensure render texture is updated after initialization
    // Use requestAnimationFrame to ensure screen dimensions are set
    requestAnimationFrame(() => {
      this.#checkAndUpdateRenderTexture();
    });

    await this.#loadTextures();
    this.#audioEngine = new AudioEngine();
    await this.#initializeAudio();
    this.#setupServices();
    this.#setupPipeline();
    this.#setupInputListeners();
    this.#setupTickers();
    this.#connect();
  }

  async #initializeAudio() {
    if (!this.#audioEngine) {
      this.#audioEngine = new AudioEngine();
    }

    if (this.#resolveAudioDisabledFromURL()) {
      console.info("[audio] disabled for agent/test run");
      return;
    }

    await this.#audioEngine.initialize();

    // Load audio settings from localStorage and apply them
    const settings = audioSettings();
    settings.load();

    // Load settings directly from localStorage to avoid timing issues
    const STORAGE_KEY = "audio-settings";
    let loadedMasterVolume = 1.0;
    let loadedVolumes = { game: 1.0, ui: 1.0, music: 0.5, ambience: 1.0 };
    let loadedMutes = { game: false, ui: false, music: false, ambience: false };

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.masterVolume !== undefined) {
          loadedMasterVolume = parsed.masterVolume;
        }
        if (parsed.volumes) {
          loadedVolumes = { ...loadedVolumes, ...parsed.volumes };
        }
        if (parsed.mutes) {
          loadedMutes = { ...loadedMutes, ...parsed.mutes };
        }
      }
    } catch (e) {
      console.warn("Failed to load audio settings from localStorage:", e);
    }

    // Apply settings to audio engine
    this.#audioEngine.setMasterVolume(loadedMasterVolume);
    this.#audioEngine.setCategoryVolume("game", loadedVolumes.game);
    this.#audioEngine.setCategoryVolume("ui", loadedVolumes.ui);
    this.#audioEngine.setCategoryVolume("music", loadedVolumes.music);
    this.#audioEngine.setCategoryVolume("ambience", loadedVolumes.ambience);
    this.#audioEngine.setCategoryMuted("game", loadedMutes.game);
    this.#audioEngine.setCategoryMuted("ui", loadedMutes.ui);
    this.#audioEngine.setCategoryMuted("music", loadedMutes.music);
    this.#audioEngine.setCategoryMuted("ambience", loadedMutes.ambience);

    // Start global space ambience (game sound, non-positional, always looping)
    this.#audioEngine.playLoopingSound({
      soundId: "space_ambience",
      entityId: "ambient",
      nonPositional: true,
    });

    // Resume audio context on first user interaction
    const resumeAudio = async () => {
      await this.#audioEngine?.resume();
      document.removeEventListener("click", resumeAudio);
      document.removeEventListener("keydown", resumeAudio);
    };
    document.addEventListener("click", resumeAudio, { once: true });
    document.addEventListener("keydown", resumeAudio, { once: true });
  }

  #setupRetroRendering() {
    // Create container for game content
    this.#gameContainer.addChild(this.#starfield.getContainer());
    this.#gameContainer.addChild(this.#camera);

    // Create render texture at 0.75x resolution
    this.#updateRenderTexture();

    // Create sprite to display the render texture
    this.#renderSprite = new Sprite(this.#renderTexture!);
    this.#renderSprite.texture.source.scaleMode = "nearest";
    this.#renderSprite.anchor.set(0, 0); // Anchor at top-left
    this.#renderSprite.x = 0;
    this.#renderSprite.y = 0;

    // Create and apply edge of world filter
    this.#edgeOfWorldFilter = new EdgeOfWorldFilter();
    const renderWidth = Math.floor(this.#app.screen.width * this.#renderScale);
    const renderHeight = Math.floor(
      this.#app.screen.height * this.#renderScale
    );
    this.#edgeOfWorldFilter.setResolution(renderWidth, renderHeight);
    this.#renderSprite.filters = [this.#edgeOfWorldFilter];

    this.#app.stage.addChild(this.#renderSprite);

    // Handle window resize
    const handleResize = () => {
      // Use a small delay to ensure PixiJS has updated its screen dimensions
      requestAnimationFrame(() => {
        this.#checkAndUpdateRenderTexture();
      });
    };
    window.addEventListener("resize", handleResize);

    // Also listen to app resize events
    this.#app.renderer.on("resize", handleResize);

    // Render game container to texture each frame and check for size changes
    this.#app.ticker.add(() => {
      // Check if screen dimensions changed and update if needed
      this.#checkAndUpdateRenderTexture();

      if (this.#renderTexture && this.#gameContainer) {
        this.#app.renderer.render(this.#gameContainer, {
          renderTexture: this.#renderTexture,
        });
      }
    });
  }

  #checkAndUpdateRenderTexture() {
    const screenWidth = this.#app.screen.width;
    const screenHeight = this.#app.screen.height;

    // Only update if dimensions actually changed
    if (
      screenWidth === this.#lastScreenWidth &&
      screenHeight === this.#lastScreenHeight
    ) {
      return;
    }

    this.#lastScreenWidth = screenWidth;
    this.#lastScreenHeight = screenHeight;
    this.#updateRenderTexture();
  }

  #updateRenderTexture() {
    const screenWidth = this.#app.screen.width;
    const screenHeight = this.#app.screen.height;
    const renderWidth = Math.floor(screenWidth * this.#renderScale);
    const renderHeight = Math.floor(screenHeight * this.#renderScale);

    if (this.#renderTexture) {
      this.#renderTexture.destroy(true);
    }

    this.#renderTexture = RenderTexture.create({
      width: renderWidth,
      height: renderHeight,
      resolution: 1,
    });
    this.#renderTexture.source.scaleMode = "nearest";

    if (this.#renderSprite) {
      this.#renderSprite.texture = this.#renderTexture;
      this.#renderSprite.texture.source.scaleMode = "nearest";
      // Scale sprite to fill screen exactly
      const scaleX = screenWidth / renderWidth;
      const scaleY = screenHeight / renderHeight;
      this.#renderSprite.scale.set(scaleX, scaleY);
      this.#renderSprite.x = 0;
      this.#renderSprite.y = 0;

      // Update default cursor position in render space
      this.#controls.cursorScreen = {
        x: renderWidth / 2,
        y: renderHeight / 2,
      };

      // Update edge filter resolution when screen resizes
      if (this.#edgeOfWorldFilter) {
        this.#edgeOfWorldFilter.setResolution(renderWidth, renderHeight);
      }
    }
  }

  #setupServices() {
    if (
      !this.#textures.player ||
      !this.#textures.pirate ||
      !this.#textures.bullet ||
      !this.#textures.explosion
    ) {
      throw new Error("Textures not loaded");
    }
    if (!this.#audioEngine) {
      throw new Error("Audio engine not initialized");
    }
    const self = this;
    const effectQueues = {
      damageTexts: [] as DamageTextRequest[],
      explosions: [] as ExplosionRequest[],
    };
    this.#services = {
      controls: this.#controls,
      snapshotBuffer: this.#snapshotBuffer,
      inputBuffer: this.#inputBuffer,
      cameraShake: this.#cameraShake,
      entityIndex: this.#entityIndex,
      stores: {
        transform: this.#transformStore,
        velocity: this.#velocityStore,
        renderable: this.#renderableStore,
        shipControl: this.#shipControlStore,
        networkState: this.#networkStateStore,
      },
      pixi: {
        app: this.#app,
        camera: this.#camera,
        starfield: this.#starfield,
        get renderWidth() {
          return Math.floor(self.#app.screen.width * self.#renderScale);
        },
        get renderHeight() {
          return Math.floor(self.#app.screen.height * self.#renderScale);
        },
      },
      stats: this.#statsGetter,
      textures: {
        player: this.#textures.player,
        playerDamaged1: this.#textures.playerDamaged1!,
        playerDamaged2: this.#textures.playerDamaged2!,
        pirate: this.#textures.pirate,
        pirateDamaged1: this.#textures.pirateDamaged1!,
        pirateDamaged2: this.#textures.pirateDamaged2!,
        asteroids: this.#textures.asteroids,
        bullet: this.#textures.bullet,
        glare: this.#textures.glare!,
        hint: this.#textures.hint!,
        bulletHint: this.#textures.bulletHint!,
        explosion: this.#textures.explosion!,
        jetstream: this.#textures.jetstream!,
        exp1: this.#textures.exp1!,
        exp2: this.#textures.exp2!,
        exp3: this.#textures.exp3!,
      },
      player: {
        id: null,
        entityId: null,
      },
      network: {
        sendInput: (input, options) => this.#sendInput(input, options),
        sendCameraBounds: (viewBounds) => this.#sendCameraBounds(viewBounds),
        predictedServerTime: () => this.#predictedServerTime(),
        renderDelayMs: RENDER_DELAY_MS,
      },
      debug: {
        get drawGrid() {
          return self.#drawGrid;
        },
        get drawWorldBorder() {
          return self.#drawWorldBorder;
        },
        get drawColliders() {
          return self.#drawColliders;
        },
        get disableInterpolation() {
          return self.#disableInterpolation;
        },
        get disableReconciliation() {
          return self.#disableReconciliation;
        },
        setDrawGrid: (value) => {
          self.setDrawGrid(value);
        },
        setDrawWorldBorder: (value) => {
          self.setDrawWorldBorder(value);
        },
        setDrawColliders: (value) => {
          self.setDrawColliders(value);
        },
        setDisableInterpolation: (value) => {
          self.setDisableInterpolation(value);
        },
        setDisableReconciliation: (value) => {
          self.setDisableReconciliation(value);
        },
      },
      world: {
        radius: 2000,
      },
      effectQueues,
      effects: {
        queueDamageText: (payload) => {
          effectQueues.damageTexts.push(payload);
        },
        queueExplosion: (payload) => {
          effectQueues.explosions.push(payload);
        },
      },
      audio: this.#audioEngine,
      audioSettings: audioSettings,
    };
  }

  #setupPipeline() {
    if (!this.#services) {
      throw new Error("Services not initialized");
    }
    this.#pipeline = new Pipeline<ClientServices>({
      entities: this.#entityManager,
      services: this.#services,
    });
    this.#pipeline.register(InputSystem);
    this.#pipeline.register(InterpolationSystem);
    this.#pipeline.register(ReconciliationSystem);
    this.#pipeline.register(RenderSystem);
    this.#pipeline.register(EffectSystem);
    this.#pipeline.register(ParticleSystem);
    this.#pipeline.register(HintSystem);
    this.#pipeline.register(GridSystem);
    this.#pipeline.register(CameraSystem);
    this.#pipeline.register(AudioSystem);
    const now = performance.now();
    this.#pipeline.init(now);
    this.#fpsLastSampleTime = now;

    this.#app.ticker.add((time) => {
      const dtSeconds = time.deltaMS / 1000;
      const nowTick = performance.now();

      this.#pipeline?.tick({
        dt: dtSeconds,
        time: nowTick,
      });

      // Update edge of world filter uniforms
      if (this.#edgeOfWorldFilter && this.#services) {
        // Get camera transform
        const cameraX = this.#camera.x;
        const cameraY = this.#camera.y;
        const cameraScale = this.#camera.scale.x;

        // Convert camera position from screen space to world space
        const renderWidth = Math.floor(
          this.#app.screen.width * this.#renderScale
        );
        const renderHeight = Math.floor(
          this.#app.screen.height * this.#renderScale
        );
        const screenCenterX = renderWidth / 2;
        const screenCenterY = renderHeight / 2;
        const worldCameraX = (screenCenterX - cameraX) / cameraScale;
        const worldCameraY = (screenCenterY - cameraY) / cameraScale;

        // Update filter uniforms
        this.#edgeOfWorldFilter.setCameraPosition(worldCameraX, worldCameraY);
        this.#edgeOfWorldFilter.setCameraScale(cameraScale);
        this.#edgeOfWorldFilter.setWorldRadius(this.#services.world.radius);
        this.#edgeOfWorldFilter.setTime(nowTick);
      }

      // FPS sampling (smoothed over a short window)
      this.#fpsSampleFrames += 1;
      const elapsedMs = nowTick - this.#fpsLastSampleTime;
      if (elapsedMs >= 500) {
        const fps = (this.#fpsSampleFrames * 1000) / elapsedMs;
        const statsStore = this.#statsGetter();
        statsStore.setFps(fps);
        this.#fpsSampleFrames = 0;
        this.#fpsLastSampleTime = nowTick;
      }

      // Poll gamepad state
      this.#pollGamepad();
    });
  }

  #pollGamepad() {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0]; // Use first connected gamepad

    if (!gamepad) {
      // No gamepad connected, clear gamepad angle
      if (this.#controls.controlMode === "gamepad") {
        this.#controls.gamepadAngle = null;
      }
      return;
    }

    const STICK_DEADZONE = 0.15;
    const TRIGGER_THRESHOLD = 0.1;

    // Read left stick ONLY (axes 0, 1) - ignore right stick completely
    const stickX = gamepad.axes[0] ?? 0;
    const stickY = gamepad.axes[1] ?? 0;
    const stickMagnitude = Math.sqrt(stickX * stickX + stickY * stickY);

    // Read triggers
    // Triggers are typically on axes 4 and 5 (Xbox controllers) or buttons 6 and 7
    // IMPORTANT: Axes 2 and 3 are typically the RIGHT STICK, so we completely ignore them
    // Left trigger: try axis 4 first, then button 6 (NEVER use axis 2 - that's right stick X)
    let leftTriggerActive = false;
    const leftTriggerAxis4 = gamepad.axes[4];

    // Check axis 4 (most common for Xbox controllers)
    if (leftTriggerAxis4 !== undefined) {
      if (leftTriggerAxis4 >= 0) {
        leftTriggerActive = leftTriggerAxis4 > TRIGGER_THRESHOLD;
      } else {
        leftTriggerActive = leftTriggerAxis4 > (-1 + TRIGGER_THRESHOLD * 2);
      }
    }
    // Fallback to button 6 if axis 4 not available
    const leftTriggerButton = gamepad.buttons[6]?.pressed ?? false;
    leftTriggerActive = leftTriggerActive || leftTriggerButton;

    // Right trigger: try axis 5 first, then button 7 (NEVER use axis 3 - that's right stick Y)
    let rightTriggerActive = false;
    const rightTriggerAxis5 = gamepad.axes[5];

    // Check axis 5 (most common for Xbox controllers)
    if (rightTriggerAxis5 !== undefined) {
      if (rightTriggerAxis5 >= 0) {
        rightTriggerActive = rightTriggerAxis5 > TRIGGER_THRESHOLD;
      } else {
        rightTriggerActive = rightTriggerAxis5 > (-1 + TRIGGER_THRESHOLD * 2);
      }
    }
    // Fallback to button 7 if axis 5 not available
    const rightTriggerButton = gamepad.buttons[7]?.pressed ?? false;
    rightTriggerActive = rightTriggerActive || rightTriggerButton;

    // Read buttons
    // Right button (RB/R1): button 5 on Xbox/PlayStation controllers
    const rightButton = gamepad.buttons[5]?.pressed ?? false;
    const startButton = gamepad.buttons[9]?.pressed ?? false; // Start button

    // Detect any gamepad input to switch to gamepad mode
    // Only check left stick (axes 0, 1), triggers, and buttons - completely ignore right stick (axes 2, 3)
    // Check buttons but exclude any that might be mapped to right stick
    const hasGamepadInput =
      stickMagnitude > STICK_DEADZONE ||
      leftTriggerActive ||
      rightTriggerActive ||
      rightButton ||
      startButton ||
      // Check buttons, but be careful not to include right stick axes
      gamepad.buttons.some((btn, idx) => btn?.pressed);

    const wasGamepadMode = this.#controls.controlMode === "gamepad";

    if (hasGamepadInput && this.#controls.controlMode !== "gamepad") {
      this.#controls.controlMode = "gamepad";
    }

    // If we just switched away from gamepad mode, clear gamepad controls
    if (wasGamepadMode && this.#controls.controlMode !== "gamepad") {
      this.#controls.thrust = false;
      this.#controls.gamepadAngle = null;
    }

    // Initialize previous button states array if needed
    if (this.#controls.previousGamepadButtons.length < gamepad.buttons.length) {
      this.#controls.previousGamepadButtons = new Array(
        Math.max(gamepad.buttons.length, 10)
      ).fill(false);
    }

    // Only apply gamepad inputs when in gamepad mode
    if (this.#controls.controlMode === "gamepad") {
      // Left stick: calculate angle for ship rotation
      if (stickMagnitude > STICK_DEADZONE) {
        // Calculate angle from stick direction
        const angle = Math.atan2(stickY, stickX);
        this.#controls.gamepadAngle = angle;
      } else {
        // Stick is centered, keep last angle or use current ship angle
        if (this.#controls.gamepadAngle === null && this.#services?.player.entityId) {
          const transform = this.#services.stores.transform.get(
            this.#services.player.entityId
          );
          if (transform) {
            this.#controls.gamepadAngle = transform.angle;
          }
        }
      }

      // Left trigger: throttle (only set when in gamepad mode)
      this.#controls.thrust = leftTriggerActive;

      // Right trigger: fire (with edge detection)
      const previousRightTrigger = this.#controls.previousGamepadButtons[7] ?? false;
      if (rightTriggerActive && !previousRightTrigger) {
        // Trigger just pressed, fire once
        this.#controls.fire = true;
      }
      this.#controls.previousGamepadButtons[7] = rightTriggerActive;

      // Right button (RB): toggle static camera (edge detection)
      // Only use button 5 (RB/R1)
      const previousRightButton = this.#controls.previousGamepadButtons[5] ?? false;

      // Toggle on button press (edge detection)
      if (rightButton && !previousRightButton) {
        // Button just pressed, toggle static camera
        this.#controls.staticCamera = !this.#controls.staticCamera;
      }
      // Update button state
      this.#controls.previousGamepadButtons[5] = rightButton;
    }

    // Start button: handle menu respawn (works regardless of control mode)
    const previousStartButton = this.#controls.previousGamepadButtons[9] ?? false;
    if (startButton && !previousStartButton) {
      // Start button just pressed
      const stats = this.#statsGetter();
      if (stats.playerId !== null && stats.playerObject === null) {
        // Player is in menu (not spawned)
        // Try to get player name from input field, or use default
        let playerName = "Player";
        const nameInput = document.querySelector(
          'input[name="playerName"], .name-input'
        ) as HTMLInputElement;
        if (nameInput && nameInput.value.trim()) {
          playerName = nameInput.value.trim();
        } else {
          // Try to get from existing player data
          const existingPlayer = stats.players.find((p) => p.id === stats.playerId);
          if (existingPlayer?.name) {
            playerName = existingPlayer.name;
          }
        }
        this.playUIClick();
        this.respawn(playerName);
      }
    }
    this.#controls.previousGamepadButtons[9] = startButton;
  }

  #setupInputListeners() {
    const updateCursor = (e: import("pixi.js").FederatedPointerEvent) => {
      // Switch to keyboard mode on mouse movement
      if (this.#controls.controlMode !== "keyboard") {
        this.#controls.controlMode = "keyboard";
      }
      // Convert screen coordinates to game render space (0.75x resolution)
      const newCursorScreen = {
        x: e.global.x * this.#renderScale,
        y: e.global.y * this.#renderScale,
      };

      // Check if mouse has actually moved (not just a click)
      if (this.#controls.lastCursorScreenForMouseCheck) {
        const dx = newCursorScreen.x - this.#controls.lastCursorScreenForMouseCheck.x;
        const dy = newCursorScreen.y - this.#controls.lastCursorScreenForMouseCheck.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // If mouse moved more than 1 pixel, mark it as moved
        if (distance > 1) {
          this.#controls.mouseHasMovedSinceKeyboardRotation = true;
        }
      } else {
        // First time, assume mouse has moved
        this.#controls.mouseHasMovedSinceKeyboardRotation = true;
      }

      this.#controls.cursorScreen = newCursorScreen;
      this.#controls.lastCursorScreenForMouseCheck = newCursorScreen;
    };
    this.#app.stage.on("pointermove", updateCursor);
    this.#app.stage.on("pointerdown", updateCursor);

    window.addEventListener("keydown", (e) => {
      // Switch to keyboard mode on any key press
      if (this.#controls.controlMode !== "keyboard") {
        this.#controls.controlMode = "keyboard";
      }

      // Apply keyboard inputs when in keyboard mode or null (initial state)
      const isKeyboardMode = this.#controls.controlMode === "keyboard" || this.#controls.controlMode === null;
      if (isKeyboardMode) {
        if (e.code === "KeyW" || e.code === "ArrowUp") {
          this.#controls.thrust = true;
        }
        if (e.code === "Space" || e.code === "KeyZ") {
          this.#controls.fire = true;
        }
        if (e.code === "ArrowLeft") {
          this.#controls.keyboardRotateLeft = true;
        }
        if (e.code === "ArrowRight") {
          this.#controls.keyboardRotateRight = true;
        }
        // Only set staticCamera with keyboard when in keyboard mode (not null, to avoid conflicts)
        if (this.#controls.controlMode === "keyboard") {
          if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
            this.#controls.staticCamera = true;
          }
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      // Apply keyboard inputs when in keyboard mode or null (initial state)
      const isKeyboardMode = this.#controls.controlMode === "keyboard" || this.#controls.controlMode === null;
      if (isKeyboardMode) {
        if (e.code === "KeyW" || e.code === "ArrowUp") {
          this.#controls.thrust = false;
        }
        if (e.code === "ArrowLeft") {
          this.#controls.keyboardRotateLeft = false;
        }
        if (e.code === "ArrowRight") {
          this.#controls.keyboardRotateRight = false;
        }
        // Only set staticCamera with keyboard when in keyboard mode (not null, to avoid conflicts)
        if (this.#controls.controlMode === "keyboard") {
          if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
            this.#controls.staticCamera = false;
          }
        }
      }
    });
    window.addEventListener("mousedown", (e) => {
      if (!this.#services?.player.entityId || !this.#services.player.id) {
        return;
      }

      // Apply mouse inputs when in keyboard mode or null (initial state)
      if ((this.#controls.controlMode === "keyboard" || this.#controls.controlMode === null) && e.button === 0) {
        this.#controls.fire = true;
      }
    });

    // Gamepad connect/disconnect listeners
    window.addEventListener("gamepadconnected", (e) => {
      console.log("Gamepad connected:", e.gamepad.id);
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      console.log("Gamepad disconnected:", e.gamepad.id);
      // If gamepad was the active control mode, reset to null
      if (this.#controls.controlMode === "gamepad") {
        this.#controls.controlMode = null;
      }
    });
  }

  #setupTickers() {
    this.#pingTicker.minFPS = 0;
    this.#pingTicker.maxFPS = 2;
    this.#pingTicker.add(() => {
      if (!this.#ws) return;
      const payload = event({
        type: "player:ping",
        sequence: this.#pingSequence++,
        clientTime: performance.now(),
      }).serialize();
      this.#sendWithLatency(payload);
    });

    this.#networkStatsTicker.minFPS = 0;
    this.#networkStatsTicker.maxFPS = 1;
    this.#networkStatsTicker.add(() => {
      const inboundKB = this.#inboundBytes / 1000;
      const outboundKB = this.#outboundBytes / 1000;
      this.#statsGetter().setInboundBytes(inboundKB);
      this.#statsGetter().setOutboundBytes(outboundKB);
      this.#inboundBytes = 0;
      this.#outboundBytes = 0;
    });
  }

  #connect() {
    if (this.#connectTimeout) {
      clearTimeout(this.#connectTimeout);
      this.#connectTimeout = null;
    }

    this.#connectionAttempts++;

    if (this.#connectionAttempts > this.#maxConnectionAttempts) {
      console.error("[net] Max connection attempts reached, giving up");
      this.#statsGetter().setConnectionError(true);
      this.#statsGetter().setIsReconnecting(false);
      return;
    }

    const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
      window.location.host
    }/ws`;
    console.log(
      `[net] Connecting to ${wsUrl} (attempt ${this.#connectionAttempts})`
    );

    this.#ws = new WebSocket(wsUrl);

    this.#ws.onopen = () => {
      console.log("[net] Connected successfully");
      this.#connectionAttempts = 0; // Reset on successful connection
      this.#resetSnapshotTimingDebug();
      this.#statsGetter().setConnectionError(false);
      this.#statsGetter().setIsReconnecting(false);
      this.#pingTicker.start();
      this.#networkStatsTicker.start();
      // Reset network stats counters on connect
      this.#inboundBytes = 0;
      this.#outboundBytes = 0;
    };

    this.#ws.onerror = (error) => {
      console.error("[net] WebSocket error:", error);
    };

    this.#ws.onclose = () => {
      this.#handleDisconnect();
    };

    this.#ws.onmessage = async (eventMessage) => {
      this.#trackInboundBytes(eventMessage.data);
      await this.#networkDecoder.process(eventMessage, (message) =>
        this.#handleMessage(message)
      );
    };
  }

  #trackInboundBytes(data: string | ArrayBuffer | Blob) {
    if (typeof data === "string") {
      const encoder = new TextEncoder();
      this.#inboundBytes += encoder.encode(data).length;
    } else if (data instanceof ArrayBuffer) {
      this.#inboundBytes += data.byteLength;
    } else if (data instanceof Blob) {
      this.#inboundBytes += data.size;
    }
  }

  #handleMessage(message: NetworkEvent) {
    switch (message.type) {
      case "server:pong":
        this.#handlePong(message);
        break;
      case "server:player-initialize":
        if (this.#services) {
          this.#services.player.id = message.playerId;
          this.#services.world.radius = message.worldRadius;
        }
        this.#statsGetter().setPlayerId(message.playerId);
        this.#statsGetter().setWorldRadius(message.worldRadius);
        break;
      case "server:state":
        this.#trackSnapshotArrivalTiming(message);
        this.#snapshotBuffer.add(message);
        this.#statsGetter().setPlayers(message.players);
        this.#statsGetter().setTickDuration(message.tickDuration);
        if (message.state.type === "full") {
          this.#statsGetter().setObjectsCount(message.state.entities.length);
        } else {
          const currentObjects = this.#statsGetter().objectsCount;
          this.#statsGetter().setObjectsCount(
            Math.max(
              0,
              currentObjects +
                message.state.updated.length -
                message.state.removed.length
            )
          );
        }
        if (message.radar) {
          this.#statsGetter().setRadarData(message.radar);
        }
        break;
      case "server:respawn-denied":
        this.#statsGetter().setRespawnError(message.reason);
        break;
      case "entity:damage":
        if (!this.#services) break;
        {
          const entityId = this.#services.entityIndex.get(message.entityId);
          if (entityId === undefined) {
            break;
          }

          // Verify entity exists in world - check if it has transform
          const transform = this.#services.stores.transform.get(entityId);
          if (!transform) {
            // Entity doesn't exist in world yet, skip sound
            break;
          }

          const isHealing = message.amount < 0;

          this.#services.effects.queueDamageText({
            amount: message.amount,
            x: message.x,
            y: message.y,
          });

          // Skip sounds and explosions for healing
          if (isHealing) {
            break;
          }

          const networkState = this.#services.stores.networkState.get(entityId);

          // Play damage sound only if entity exists in world
          if (networkState?.state?.type === "ship") {
            // Ship damage - use snd_hit for ships
            this.#services.audio.playOneShot({
              soundId: "snd_hit",
              position: { x: message.x, y: message.y },
            });
            // Queue explosion visual effect (explode sound will play on entity:destroy)
            this.#services.effects.queueExplosion({
              x: message.x,
              y: message.y,
            });
          } else if (networkState?.state) {
            // Other entity damage (asteroids, etc.) - use snd_small_hit
            // Only play if entity has network state (exists in world)
            this.#services.audio.playOneShot({
              soundId: "snd_small_hit",
              position: { x: message.x, y: message.y },
            });
          }

          // Check if this damage killed the local player
          if (message.entityId === this.#services.player.id) {
            const entityNetworkState = this.#services.stores.networkState.get(entityId);
            if (entityNetworkState?.state?.type === "ship") {
              const health = entityNetworkState.state.health ?? entityNetworkState.state.maxHealth ?? 1;
              if (health <= message.amount) {
                // Player will die from this damage
                this.#services.audio.playOneShot({ soundId: "snd_death" });
              }
            }
          }
        }
        break;
      case "entity:destroy":
        if (!this.#services) break;
        {
          // Verify entity existed in world before playing explode sound
          const entityId = this.#services.entityIndex.get(message.entityId);
          const hadTransform = entityId !== undefined &&
            this.#services.stores.transform.has(entityId);

          // Only play explode sound if entity existed in world
          if (hadTransform) {
            // Play explosion sound immediately when event comes in
            this.#services.audio.playOneShot({
              soundId: "snd_explode",
              position: { x: message.x, y: message.y },
            });
          }

          // Queue explosion effect for visual (always, even if entity wasn't in world)
          this.#services.effects.queueExplosion({
            x: message.x,
            y: message.y,
          });
        }
        break;
      case "player:score":
        if (!this.#services) break;
        // Play fuel sound when player gains exp/score with randomized pitch
        const pitch = 0.8 + Math.random() * 0.4; // Random pitch between 0.8 and 1.2
        this.#services.audio.playOneShot({ soundId: "snd_fuel", pitch });
        // Add floating score text
        this.#statsGetter().addFloatingScoreText(message.delta);
        break;
      case "player:level-up":
        if (!this.#services) break;
        // Play pick energy sound when player levels up
        this.#services.audio.playOneShot({ soundId: "snd_pick_energy" });
        break;
    }
  }

  #handlePong(message: Extract<NetworkEvent, { type: "server:pong" }>) {
    const clientReceive = performance.now();
    const clientSend = message.clientTime;
    const serverSend = message.serverTime;
    const rttSample = clientReceive - clientSend;
    const oneWay = rttSample / 2;
    const serverAtReceiveApprox = serverSend + oneWay;
    const offsetSample = serverAtReceiveApprox - clientReceive;

    const alpha = 0.1;
    const statsStore = this.#statsGetter();
    const { latency, offset, hasTimeSync } = statsStore;

    if (!hasTimeSync) {
      statsStore.setLatency(rttSample);
      statsStore.setOffset(offsetSample);
      statsStore.setHasTimeSync(true);
    } else {
      statsStore.setLatency((1 - alpha) * latency + alpha * rttSample);
      statsStore.setOffset((1 - alpha) * offset + alpha * offsetSample);
    }
  }

  #trackSnapshotArrivalTiming(
    message: Extract<NetworkEvent, { type: "server:state" }>
  ) {
    if (!this.#snapshotTimingDebugEnabled) {
      return;
    }

    const now = performance.now();
    const previousArrivalTime = this.#lastSnapshotArrivalTimeMs;
    this.#lastSnapshotArrivalTimeMs = now;

    if (previousArrivalTime === null) {
      return;
    }

    const intervalMs = now - previousArrivalTime;
    const averageIntervalMs = this.#getAverageSnapshotArrivalIntervalMs();

    if (
      averageIntervalMs !== null &&
      this.#isTooLongSnapshotInterval(intervalMs, averageIntervalMs)
    ) {
      const snapshotKind = message.state.type === "full" ? "full" : "delta";
      console.warn(
        `[net] слишком долгий ${snapshotKind} кадр - ${Math.round(
          intervalMs
        )}мс (в среднем ${Math.round(averageIntervalMs)}мс)`
      );
    }

    this.#snapshotArrivalIntervalsMs.push(intervalMs);
    if (
      this.#snapshotArrivalIntervalsMs.length > SNAPSHOT_TIMING_SAMPLE_SIZE
    ) {
      this.#snapshotArrivalIntervalsMs.shift();
    }
  }

  #getAverageSnapshotArrivalIntervalMs() {
    if (
      this.#snapshotArrivalIntervalsMs.length < SNAPSHOT_TIMING_MIN_SAMPLES
    ) {
      return null;
    }

    const total = this.#snapshotArrivalIntervalsMs.reduce(
      (sum, intervalMs) => sum + intervalMs,
      0
    );
    return total / this.#snapshotArrivalIntervalsMs.length;
  }

  #isTooLongSnapshotInterval(intervalMs: number, averageIntervalMs: number) {
    return (
      intervalMs >= averageIntervalMs * SNAPSHOT_TIMING_WARN_FACTOR &&
      intervalMs - averageIntervalMs >= SNAPSHOT_TIMING_WARN_MIN_DELTA_MS
    );
  }

  #resetSnapshotTimingDebug() {
    this.#snapshotArrivalIntervalsMs.length = 0;
    this.#lastSnapshotArrivalTimeMs = null;
  }

  #handleDisconnect() {
    this.#pingTicker.stop();
    this.#networkStatsTicker.stop();
    this.#ws = null;
    this.#resetSnapshotTimingDebug();
    this.#snapshotBuffer.clear();
    this.#inputBuffer.reset();
    this.#entityIndex.clear();
    this.#entityManager.clear();
    const statsStore = this.#statsGetter();
    statsStore.setLatency(0);
    statsStore.setOffset(0);
    statsStore.setHasTimeSync(false);
    statsStore.setObjectsCount(0);
    statsStore.setPlayerObject(null);
    statsStore.setPlayerId(null);
    statsStore.setDeathPosition(null);
    statsStore.setPlayers([]);
    statsStore.setRadarData(null);
    statsStore.setInboundBytes(0);
    statsStore.setOutboundBytes(0);
    this.#inboundBytes = 0;
    this.#outboundBytes = 0;

    // Stop music on disconnect
    if (this.#audioEngine) {
      this.#audioEngine.stopMusic({ musicId: "msg_song", fadeOutMs: 500 });
    }

    if (this.#services) {
      this.#services.player.entityId = null;
      this.#services.player.id = null;
      this.#services.stores.renderable.forEach((renderable, _entity) => {
        if (renderable.ref) {
          this.#services?.pixi.camera.removeChild(renderable.ref);
          renderable.ref.destroy();
        }
      });
      this.#services.stores.transform.clear();
      this.#services.stores.velocity.clear();
      this.#services.stores.renderable.clear();
      this.#services.stores.shipControl.clear();
      this.#services.stores.networkState.clear();
    }
    this.#camera.removeChildren();

    // Set reconnecting state before attempting to reconnect
    statsStore.setIsReconnecting(true);

    if (this.#connectTimeout) clearTimeout(this.#connectTimeout);
    this.#connectTimeout = setTimeout(() => this.#connect(), 500);
  }

  #sendInput(
    input: {
      thrust: boolean;
      angle: number;
      fire: boolean;
      firingCompensation?: boolean;
      viewBounds?: {
        centerX: number;
        centerY: number;
        width: number;
        height: number;
      };
    },
    options?: {
      fields?: Array<"thrust" | "angle" | "fire" | "firingCompensation" | "viewBounds">;
    }
  ): ShipInputCommand | null {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return null;
    const command: ShipInputCommand = {
      sequence: this.#inputSequence++,
      thrust: input.thrust,
      angle: input.angle,
      fire: input.fire,
      timestamp: this.#predictedServerTime(),
    };
    const includeFields = options?.fields ?? ["thrust", "angle", "fire"];
    const payloadInput: PlayerInputEvent["input"] = {};
    if (includeFields.includes("thrust")) {
      payloadInput.thrust = command.thrust;
    }
    if (includeFields.includes("angle")) {
      payloadInput.angle = command.angle;
    }
    if (includeFields.includes("fire") && command.fire) {
      payloadInput.fire = command.fire;

      if (
        includeFields.includes("firingCompensation") &&
        input.firingCompensation !== undefined
      ) {
        payloadInput.firingCompensation = input.firingCompensation;
      }
    }

    if (Object.keys(payloadInput).length === 0) {
      return null;
    }
    const payload = event({
      type: "player:input",
      sequence: command.sequence,
      input: payloadInput,
      latency: this.#statsGetter().latency,
    }).serialize();
    this.#sendWithLatency(payload);
    return command;
  }

  #predictedServerTime() {
    const { hasTimeSync, offset } = this.#statsGetter();
    if (!hasTimeSync) return performance.now();
    return performance.now() + offset;
  }

  async #loadTextures() {
    const [
      player,
      playerDamaged1,
      playerDamaged2,
      pirate,
      pirateDamaged1,
      pirateDamaged2,
      bullet,
      glare,
      hint,
      bulletHint,
      explosion,
      jetstream,
      exp1,
      exp2,
      exp3,
    ] = await Promise.all([
      Assets.load<Texture>(playerTextureSrc),
      Assets.load<Texture>(playerDamaged1TextureSrc),
      Assets.load<Texture>(playerDamaged2TextureSrc),
      Assets.load<Texture>(pirateTextureSrc),
      Assets.load<Texture>(pirateDamaged1TextureSrc),
      Assets.load<Texture>(pirateDamaged2TextureSrc),
      Assets.load<Texture>(bulletTextureSrc),
      Assets.load<Texture>(glareTextureSrc),
      Assets.load<Texture>(hintBwTextureSrc),
      Assets.load<Texture>(bulletHintTextureSrc),
      Assets.load<Texture>(explosionTextureSrc),
      Assets.load<Texture>(jetstreamTextureSrc),
      Assets.load<Texture>(exp1TextureSrc),
      Assets.load<Texture>(exp2TextureSrc),
      Assets.load<Texture>(exp3TextureSrc),
    ]);

    const [
      asteroidSmall1,
      asteroidSmall2,
      asteroidMedium1,
      asteroidMedium2,
      asteroidLarge1,
      asteroidLarge2,
    ] = await Promise.all([
      Assets.load<Texture>(asteroidSmall1TextureSrc),
      Assets.load<Texture>(asteroidSmall2TextureSrc),
      Assets.load<Texture>(asteroidMedium1TextureSrc),
      Assets.load<Texture>(asteroidMedium2TextureSrc),
      Assets.load<Texture>(asteroidLarge1TextureSrc),
      Assets.load<Texture>(asteroidLarge2TextureSrc),
    ]);

    // Ensure all textures use nearest neighbor scaling
    player.source.scaleMode = "nearest";
    playerDamaged1.source.scaleMode = "nearest";
    playerDamaged2.source.scaleMode = "nearest";
    pirate.source.scaleMode = "nearest";
    pirateDamaged1.source.scaleMode = "nearest";
    pirateDamaged2.source.scaleMode = "nearest";
    bullet.source.scaleMode = "nearest";
    glare.source.scaleMode = "nearest";
    hint.source.scaleMode = "nearest";
    bulletHint.source.scaleMode = "nearest";
    explosion.source.scaleMode = "nearest";
    jetstream.source.scaleMode = "nearest";
    exp1.source.scaleMode = "nearest";
    exp2.source.scaleMode = "nearest";
    exp3.source.scaleMode = "nearest";

    asteroidSmall1.source.scaleMode = "nearest";
    asteroidSmall2.source.scaleMode = "nearest";
    asteroidMedium1.source.scaleMode = "nearest";
    asteroidMedium2.source.scaleMode = "nearest";
    asteroidLarge1.source.scaleMode = "nearest";
    asteroidLarge2.source.scaleMode = "nearest";

    this.#textures.player = player;
    this.#textures.playerDamaged1 = playerDamaged1;
    this.#textures.playerDamaged2 = playerDamaged2;
    this.#textures.pirate = pirate;
    this.#textures.pirateDamaged1 = pirateDamaged1;
    this.#textures.pirateDamaged2 = pirateDamaged2;
    this.#textures.asteroids.small = [asteroidSmall1, asteroidSmall2];
    this.#textures.asteroids.medium = [asteroidMedium1, asteroidMedium2];
    this.#textures.asteroids.large = [asteroidLarge1, asteroidLarge2];
    this.#textures.bullet = bullet;
    this.#textures.glare = glare;
    this.#textures.hint = hint;
    this.#textures.bulletHint = bulletHint;
    this.#textures.explosion = explosion;
    this.#textures.jetstream = jetstream;
    this.#textures.exp1 = exp1;
    this.#textures.exp2 = exp2;
    this.#textures.exp3 = exp3;
  }

  #resolveSimulatedLatency() {
    if (typeof window === "undefined") return 0;
    const params = new URLSearchParams(window.location.search);
    const value = params.get("sim-latency");
    if (!value) return 0;
    if (value === "random") {
      const min = 20;
      const max = 100;
      return Math.round(Math.random() * (max - min) + min);
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return 0;
  }

  #withSimulatedLatency(cb: () => void) {
    if (this.#simulatedLatencyMs <= 0) {
      cb();
      return;
    }
    setTimeout(cb, this.#simulatedLatencyMs);
  }

  #sendWithLatency(payload: string) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;

    // Track outbound bytes
    const encoder = new TextEncoder();
    this.#outboundBytes += encoder.encode(payload).length;

    this.#withSimulatedLatency(() => {
      this.#ws?.send(payload);
    });
  }

  #sendCameraBounds(viewBounds: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  }) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    const payload = event({
      type: "player:camera-bounds",
      viewBounds,
    }).serialize();
    this.#sendWithLatency(payload);
  }

  respawn(name: string) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;

    // Reset input buffer and sequence
    this.#inputBuffer.reset();
    this.#inputSequence = 0;

    // Clear death position and respawn error when respawning
    this.#statsGetter().setDeathPosition(null);
    this.#statsGetter().setRespawnError(null);

    // Send respawn command to server
    const payload = event({
      type: "player:respawn",
      name: name,
    }).serialize();
    this.#sendWithLatency(payload);
  }

  syncAudioSettings(): void {
    if (!this.#audioEngine) return;
    const settings = this.#services?.audioSettings();
    if (!settings) return;

    // Track previous music/game/ambience mute state to detect when categories are unmuted
    const wasMusicMuted = this.#audioEngine.isCategoryMuted("music");
    const wasGameMuted = this.#audioEngine.isCategoryMuted("game");
    const wasAmbienceMuted = this.#audioEngine.isCategoryMuted("ambience");

    this.#audioEngine.setMasterVolume(settings.masterVolume);
    this.#audioEngine.setCategoryVolume("game", settings.volumes.game);
    this.#audioEngine.setCategoryVolume("ui", settings.volumes.ui);
    this.#audioEngine.setCategoryVolume("music", settings.volumes.music);
    this.#audioEngine.setCategoryVolume("ambience", settings.volumes.ambience);
    this.#audioEngine.setCategoryMuted("game", settings.mutes.game);
    this.#audioEngine.setCategoryMuted("ui", settings.mutes.ui);
    this.#audioEngine.setCategoryMuted("music", settings.mutes.music);
    this.#audioEngine.setCategoryMuted("ambience", settings.mutes.ambience);

    // If music was just unmuted and player is alive, start playing music
    const isMusicMuted = settings.mutes.music;
    const isMusicPlaying = this.#audioEngine.isMusicPlaying("msg_song");
    const isPlayerAlive = this.#services?.player.entityId !== null;

    // Start music if it was just unmuted and player is alive
    if (wasMusicMuted && !isMusicMuted && isPlayerAlive && !isMusicPlaying) {
      this.#audioEngine.playMusic({
        musicId: "msg_song",
        loop: true,
        fadeInMs: 1000,
      });
    }

    // Ensure space ambience is playing when ambience is (re)enabled
    const isAmbienceMuted = settings.mutes.ambience;
    if (wasAmbienceMuted && !isAmbienceMuted) {
      this.#audioEngine.playLoopingSound({
        soundId: "space_ambience",
        entityId: "ambient",
        nonPositional: true,
      });
    }
  }

  playUIClick(): void {
    if (!this.#audioEngine) return;
    this.#audioEngine.playOneShot({ soundId: "snd_click" });
  }

  playUIHover(): void {
    if (!this.#audioEngine) return;
    this.#audioEngine.playOneShot({ soundId: "snd_hover" });
  }

  playUIType(): void {
    if (!this.#audioEngine) return;
    this.#audioEngine.playOneShot({ soundId: "snd_type" });
  }
}
