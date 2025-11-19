import { Application, Assets, Container, Texture, Ticker } from "pixi.js";

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
import { CameraSystem } from "./systems/camera-system";
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

  constructor() {
    this.#app = new Application();
  }

  async initialize(parent: HTMLElement) {
    await this.#app.init({
      background: "#000000",
      resizeTo: window,
    });

    parent.appendChild(this.#app.canvas);
    this.#app.canvas.style.imageRendering = "pixelated";
    this.#app.stage.addChild(this.#starfield.getContainer());
    this.#app.stage.addChild(this.#camera);
    this.#app.stage.eventMode = "static";
    this.#app.stage.hitArea = this.#app.screen;
    this.#controls.cursorScreen = {
      x: this.#app.screen.width / 2,
      y: this.#app.screen.height / 2,
    };

    await this.#loadTextures();
    this.#setupServices();
    this.#setupPipeline();
    this.#setupInputListeners();
    this.#setupTickers();
    this.#connect();
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
    this.#services = {
      controls: this.#controls,
      snapshotBuffer: this.#snapshotBuffer,
      inputBuffer: this.#inputBuffer,
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
      this.#controls.cursorScreen = { x: e.global.x, y: e.global.y };
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
      this.#ws.send(
        event({
          type: "player:ping",
          sequence: this.#pingSequence++,
          clientTime: performance.now(),
        }).serialize()
      );
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
      const message = JSON.parse(eventMessage.data) as NetworkEvent;
      this.#handleMessage(message);
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
    this.#ws.send(
      event({
        type: "player:input",
        sequence: command.sequence,
        input: {
          thrust: command.thrust,
          angle: command.angle,
          fire: command.fire,
        },
      }).serialize()
    );
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
    this.#textures.player = player;
    this.#textures.pirate = pirate;
    this.#textures.asteroid = asteroid;
    this.#textures.bullet = bullet;
  }
}
