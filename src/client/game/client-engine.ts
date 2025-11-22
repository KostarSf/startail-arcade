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
import explosionTextureSrc from "../assets/images/explosion.png";
import glareTextureSrc from "../assets/images/glare.png";
import hintBwTextureSrc from "../assets/images/hint_bw.png";
import pirateTextureSrc from "../assets/images/pirate.png";
import playerTextureSrc from "../assets/images/player.png";

import { Starfield } from "../starfield";
import { stats } from "../store";
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
import type {
  ClientServices,
  ControlState,
  DamageTextRequest,
  ExplosionRequest,
} from "./types";

const RENDER_DELAY_MS = 100;

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
  };

  #services: ClientServices | null = null;

  #textures: {
    player: Texture | null;
    pirate: Texture | null;
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
  } = {
    player: null,
    pirate: null,
    asteroids: { small: [], medium: [], large: [] },
    bullet: null,
    glare: null,
    hint: null,
    bulletHint: null,
    explosion: null,
  };

  #ws: WebSocket | null = null;
  #connectTimeout: ReturnType<typeof setTimeout> | null = null;
  #inputSequence = 0;
  #pingSequence = 0;
  #pingTicker = new Ticker();
  #simulatedLatencyMs = 0;
  #drawGrid = false;
  #drawWorldBorder = false;
  #drawColliders = false;
  #fpsSampleFrames = 0;
  #fpsLastSampleTime = 0;
  #connectionAttempts = 0;
  #maxConnectionAttempts = 5;

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

    this.#networkDecoder = new NetworkDecoder(this);
  }

  #resolveWorldBorderFromURL(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("world-border") === "true";
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
    const params = new URLSearchParams(window.location.search);
    const value = params.get("draw-colliders");
    if (value === null) return false;
    return value === "true";
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

  async initialize(parent: HTMLElement) {
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
    this.#setupServices();
    this.#setupPipeline();
    this.#setupInputListeners();
    this.#setupTickers();
    this.#connect();
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
        pirate: this.#textures.pirate,
        asteroids: this.#textures.asteroids,
        bullet: this.#textures.bullet,
        glare: this.#textures.glare!,
        hint: this.#textures.hint!,
        bulletHint: this.#textures.bulletHint!,
        explosion: this.#textures.explosion!,
      },
      player: {
        id: null,
        entityId: null,
      },
      network: {
        sendInput: (input, options) => this.#sendInput(input, options),
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
        setDrawGrid: (value) => {
          self.setDrawGrid(value);
        },
        setDrawWorldBorder: (value) => {
          self.setDrawWorldBorder(value);
        },
        setDrawColliders: (value) => {
          self.setDrawColliders(value);
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
    });
  }

  #setupInputListeners() {
    const updateCursor = (e: import("pixi.js").FederatedPointerEvent) => {
      // Convert screen coordinates to game render space (0.75x resolution)
      this.#controls.cursorScreen = {
        x: e.global.x * this.#renderScale,
        y: e.global.y * this.#renderScale,
      };
    };
    this.#app.stage.on("pointermove", updateCursor);
    this.#app.stage.on("pointerdown", updateCursor);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyW") {
        this.#controls.thrust = true;
      }
      if (e.code === "Space") {
        this.#controls.fire = true;
      }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        this.#controls.staticCamera = true;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") {
        this.#controls.thrust = false;
      }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        this.#controls.staticCamera = false;
      }
    });
    window.addEventListener("mousedown", (e) => {
      if (!this.#services?.player.entityId || !this.#services.player.id) {
        return;
      }

      if (e.button === 0) {
        this.#controls.fire = true;
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
      this.#statsGetter().setConnectionError(false);
      this.#pingTicker.start();
    };

    this.#ws.onerror = (error) => {
      console.error("[net] WebSocket error:", error);
    };

    this.#ws.onclose = () => {
      this.#handleDisconnect();
    };

    this.#ws.onmessage = async (eventMessage) =>
      await this.#networkDecoder.process(eventMessage, (message) =>
        this.#handleMessage(message)
      );
  }

  #handleMessage(message: NetworkEvent) {
    switch (message.type) {
      case "server:pong":
        this.#handlePong(message);
        break;
      case "server:player-initialize":
        if (!this.#services) return;
        this.#services.player.id = message.playerId;
        this.#services.world.radius = message.worldRadius;
        this.#statsGetter().setPlayerId(message.playerId);
        this.#statsGetter().setWorldRadius(message.worldRadius);
        break;
      case "server:state":
        this.#snapshotBuffer.add(message);
        this.#statsGetter().setPlayers(message.players);
        this.#statsGetter().setTickDuration(message.tickDuration);
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
          this.#services.effects.queueDamageText({
            amount: message.amount,
            x: message.x,
            y: message.y,
          });
          const networkState = this.#services.stores.networkState.get(entityId);
          if (networkState?.state?.type === "ship") {
            this.#services.effects.queueExplosion({
              x: message.x,
              y: message.y,
            });
          }
        }
        break;
      case "entity:destroy":
        if (!this.#services) break;
        this.#services.effects.queueExplosion({
          x: message.x,
          y: message.y,
        });
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

  #handleDisconnect() {
    this.#pingTicker.stop();
    this.#ws = null;
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

    if (this.#connectTimeout) clearTimeout(this.#connectTimeout);
    this.#connectTimeout = setTimeout(() => this.#connect(), 500);
  }

  #sendInput(
    input: {
      thrust: boolean;
      angle: number;
      fire: boolean;
      firingCompensation?: boolean;
    },
    options?: {
      fields?: Array<"thrust" | "angle" | "fire" | "firingCompensation">;
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
    const [player, pirate, bullet, glare, hint, bulletHint, explosion] =
      await Promise.all([
        Assets.load<Texture>(playerTextureSrc),
        Assets.load<Texture>(pirateTextureSrc),
        Assets.load<Texture>(bulletTextureSrc),
        Assets.load<Texture>(glareTextureSrc),
        Assets.load<Texture>(hintBwTextureSrc),
        Assets.load<Texture>(bulletHintTextureSrc),
        Assets.load<Texture>(explosionTextureSrc),
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
    pirate.source.scaleMode = "nearest";
    bullet.source.scaleMode = "nearest";
    glare.source.scaleMode = "nearest";
    hint.source.scaleMode = "nearest";
    bulletHint.source.scaleMode = "nearest";
    explosion.source.scaleMode = "nearest";

    asteroidSmall1.source.scaleMode = "nearest";
    asteroidSmall2.source.scaleMode = "nearest";
    asteroidMedium1.source.scaleMode = "nearest";
    asteroidMedium2.source.scaleMode = "nearest";
    asteroidLarge1.source.scaleMode = "nearest";
    asteroidLarge2.source.scaleMode = "nearest";

    this.#textures.player = player;
    this.#textures.pirate = pirate;
    this.#textures.asteroids.small = [asteroidSmall1, asteroidSmall2];
    this.#textures.asteroids.medium = [asteroidMedium1, asteroidMedium2];
    this.#textures.asteroids.large = [asteroidLarge1, asteroidLarge2];
    this.#textures.bullet = bullet;
    this.#textures.glare = glare;
    this.#textures.hint = hint;
    this.#textures.bulletHint = bulletHint;
    this.#textures.explosion = explosion;
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
    this.#withSimulatedLatency(() => {
      this.#ws?.send(payload);
    });
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
}
