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
import type { NetworkEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";

import asteroidTextureSrc from "../assets/images/asteroids/medium-01.png";
import bulletTextureSrc from "../assets/images/bullet.png";
import pirateTextureSrc from "../assets/images/pirate.png";
import playerTextureSrc from "../assets/images/player.png";

import { Starfield } from "../starfield";
import { stats } from "../store";
import { InputBuffer } from "./network/input-buffer";
import { SnapshotBuffer } from "./network/snapshot-buffer";
import { CameraShake } from "./systems/camera-shake";
import { CameraSystem } from "./systems/camera-system";
import { GridSystem } from "./systems/grid-system";
import { InputSystem } from "./systems/input-system";
import { InterpolationSystem } from "./systems/interpolation-system";
import { ReconciliationSystem } from "./systems/reconciliation-system";
import { RenderSystem } from "./systems/render-system";
import type { ClientServices, ControlState } from "./types";

const RENDER_DELAY_MS = 100;

export class ClientEngine {
  #app: Application;
  #camera = new Container();
  #starfield = new Starfield(500, 10000, 10000, 0.3);
  #statsGetter = stats;
  #gameContainer = new Container();
  #renderTexture: RenderTexture | null = null;
  #renderSprite: Sprite | null = null;
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
    cursorScreen: null,
    cursorWorld: null,
  };

  #services: ClientServices | null = null;

  #textures: {
    player: Texture | null;
    pirate: Texture | null;
    asteroid: Texture | null;
    bullet: Texture | null;
  } = { player: null, pirate: null, asteroid: null, bullet: null };

  #ws: WebSocket | null = null;
  #connectTimeout: ReturnType<typeof setTimeout> | null = null;
  #inputSequence = 0;
  #pingSequence = 0;
  #pingTicker = new Ticker();
  #simulatedLatencyMs = 0;
  #drawGrid = false;
  #drawWorldBorder = false;

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
    canvas.style.setProperty("image-rendering", "-moz-crisp-edges", "important");
    canvas.style.setProperty("image-rendering", "crisp-edges", "important");

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
    }
  }

  #setupServices() {
    if (
      !this.#textures.player ||
      !this.#textures.pirate ||
      !this.#textures.asteroid ||
      !this.#textures.bullet
    ) {
      throw new Error("Textures not loaded");
    }
    const self = this;
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
        asteroid: this.#textures.asteroid,
        bullet: this.#textures.bullet,
      },
      player: {
        id: null,
        entityId: null,
      },
      network: {
        sendInput: (input) => this.#sendInput(input),
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
        setDrawGrid: (value) => {
          self.setDrawGrid(value);
        },
        setDrawWorldBorder: (value) => {
          self.setDrawWorldBorder(value);
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
    this.#pipeline.register(GridSystem);
    this.#pipeline.register(CameraSystem);
    this.#pipeline.init(performance.now());

    this.#app.ticker.add((time) => {
      this.#pipeline?.tick({
        dt: time.deltaMS / 1000,
        time: performance.now(),
      });
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
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") {
        this.#controls.thrust = false;
      }
    });
    window.addEventListener("mousedown", () => {
      this.#controls.fire = true;
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
    this.#ws = new WebSocket("ws://192.168.0.107:3000/ws");
    this.#ws.onopen = () => {
      this.#pingTicker.start();
    };
    this.#ws.onclose = () => {
      this.#handleDisconnect();
    };
    this.#ws.onmessage = (eventMessage) => {
      const payload = eventMessage.data;
      this.#withSimulatedLatency(() => {
        const raw =
          typeof payload === "string" ? payload : payload.toString();
        const message = JSON.parse(raw) as NetworkEvent;
        this.#handleMessage(message);
      });
    };
  }

  #handleMessage(message: NetworkEvent) {
    switch (message.type) {
      case "server:pong":
        this.#handlePong(message);
        break;
      case "server:player-initialize":
        if (!this.#services) return;
        this.#services.player.id = message.playerId;
        this.#statsGetter().setPlayerId(message.playerId);
        break;
      case "server:state":
        this.#snapshotBuffer.add(message);
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

  #sendInput(input: {
    thrust: boolean;
    angle: number;
    fire: boolean;
  }): ShipInputCommand | null {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return null;
    const command: ShipInputCommand = {
      sequence: this.#inputSequence++,
      thrust: input.thrust,
      angle: input.angle,
      fire: input.fire,
      timestamp: this.#predictedServerTime(),
    };
    const payload = event({
      type: "player:input",
      sequence: command.sequence,
      input: {
        thrust: command.thrust,
        angle: command.angle,
        fire: command.fire,
      },
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
    const [player, pirate, asteroid, bullet] = await Promise.all([
      Assets.load<Texture>(playerTextureSrc),
      Assets.load<Texture>(pirateTextureSrc),
      Assets.load<Texture>(asteroidTextureSrc),
      Assets.load<Texture>(bulletTextureSrc),
    ]);

    // Ensure all textures use nearest neighbor scaling
    player.source.scaleMode = "nearest";
    pirate.source.scaleMode = "nearest";
    asteroid.source.scaleMode = "nearest";
    bullet.source.scaleMode = "nearest";

    this.#textures.player = player;
    this.#textures.pirate = pirate;
    this.#textures.asteroid = asteroid;
    this.#textures.bullet = bullet;
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
}
