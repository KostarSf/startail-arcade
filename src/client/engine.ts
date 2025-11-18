// description: This example demonstrates how to use a Container to group and manipulate multiple sprites
import { Application, Assets, Container, Sprite, Ticker } from "pixi.js";

import { lerp } from "@/shared/math/utils";
import type { NetworkEvent } from "@/shared/network/events";
import { event } from "@/shared/network/utils";

import { stats } from "./store";

import asteroid from "./assets/images/asteroids/medium-01.png";
import pirate from "./assets/images/pirate.png";
import player from "./assets/images/player.png";

export const init = async (parent: HTMLElement) => {
  // Create a new application
  const app = new Application();

  // Initialize the application
  await app.init({
    background: "#000000",
    resizeTo: window,
  });

  // Append the application canvas to the document body
  parent.appendChild(app.canvas);

  const camera = new Container();
  app.stage.addChild(camera);

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  let lastSequence = 0;
  const lastPlayerInput = {
    angle: 0,
    thrust: false,
    fire: false,
  };
  const lastSentPlayerInput = {
    angle: 0,
    thrust: false,
    fire: false,
  };

  let ws: WebSocket | null = null;

  const sendInputEventsTicker = new Ticker();
  sendInputEventsTicker.add(() => {
    if (
      Math.round(lastPlayerInput.angle * 100) !==
        Math.round(lastSentPlayerInput.angle * 100) ||
      lastPlayerInput.thrust !== lastSentPlayerInput.thrust ||
      lastPlayerInput.fire !== lastSentPlayerInput.fire
    ) {
      ws?.send(
        event({
          type: "player:input",
          sequence: lastSequence++,
          input: {
            angle: lastPlayerInput.angle,
            thrust: lastPlayerInput.thrust,
            fire: lastPlayerInput.fire,
          },
        }).serialize()
      );
      lastSentPlayerInput.angle = lastPlayerInput.angle;
      lastSentPlayerInput.thrust = lastPlayerInput.thrust;
      lastSentPlayerInput.fire = lastPlayerInput.fire = false;
    }
  });

  let lastPingSeq = 0;
  const sendPingTicker = new Ticker();
  sendPingTicker.minFPS = 0;
  sendPingTicker.maxFPS = 2;
  sendPingTicker.add(() => {
    ws?.send(
      event({
        type: "player:ping",
        sequence: lastPingSeq++,
        clientTime: performance.now(),
      }).serialize()
    );
  });

  // Load the bunny texture
  const playerTexture = await Assets.load(player);
  const pirateTexture = await Assets.load(pirate);
  const asteroidTexture = await Assets.load(asteroid);

  const objects = new Map<string, Container>();

  const mousePos = { x: 0, y: 0 };
  app.stage.on("pointermove", (e) => {
    mousePos.x = Math.floor((e.global.x - camera.x) / camera.scale.x);
    mousePos.y = Math.floor((e.global.y - camera.y) / camera.scale.y);

    const { playerObject, setPlayerObject } = stats();

    if (playerObject) {
      const angle = Math.atan2(
        mousePos.y - playerObject.y,
        mousePos.x - playerObject.x
      );

      playerObject.rotation = angle;
      lastPlayerInput.angle = angle;

      setPlayerObject(playerObject);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyW") {
      lastPlayerInput.thrust = true;
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") {
      lastPlayerInput.thrust = false;
    }
  });

  const connectToServer = () => {
    ws = new WebSocket("ws://192.168.0.107:3000/ws");

    ws.onclose = () => {
      console.log("Disconnected from server");
      sendInputEventsTicker.stop();
      sendPingTicker.stop();
      objects.forEach((object) => {
        camera.removeChild(object);
      });
      objects.clear();
      ws = null;
      stats().setLatency(0);
      stats().setOffset(0);
      stats().setHasTimeSync(false);

      setTimeout(() => connectToServer(), 500);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as NetworkEvent;
      switch (message.type) {
        case "server:pong":
          const clientReceive = performance.now();
          const clientSend = message.clientTime;
          const serverSend = message.serverTime;

          const rttSample = clientReceive - clientSend;
          const oneWay = rttSample / 2;

          const serverAtReceiveApprox = serverSend + oneWay;

          const offsetSample = serverAtReceiveApprox - clientReceive;

          const alpha = 0.1;
          const {
            latency,
            offset,
            hasTimeSync,
            setLatency,
            setOffset,
            setHasTimeSync,
          } = stats();

          if (!hasTimeSync) {
            setLatency(rttSample);
            setOffset(offsetSample);
            setHasTimeSync(true);
          } else {
            setLatency(lerp(latency, rttSample, alpha));
            setOffset(lerp(offset, offsetSample, alpha));
          }

          break;

        case "server:player-initialize":
          stats().setPlayerId(message.playerId);
          sendInputEventsTicker.minFPS = message.tps;
          sendInputEventsTicker.maxFPS = message.tps * 2;
          sendInputEventsTicker.start();
          sendPingTicker.start();

          break;

        case "server:state":
          const currentObjectsIds = new Set(
            message.entities.map((entity) => entity.id)
          );

          const { playerId, setPlayerObject } = stats();

          for (const entity of message.entities) {
            if (entity.type === "ship") {
              const ship =
                objects.get(entity.id) || createShip(entity.id === playerId);

              if (entity.id === playerId) {
                setPlayerObject(ship);
              }

              ship.x = entity.x;
              ship.y = entity.y;
              ship.rotation = entity.angle;

              if (!objects.has(entity.id)) {
                objects.set(entity.id, ship);
                camera.addChild(ship);
                // console.log("spawned", entity.type, entity.id);
              }
            }

            if (entity.type === "asteroid") {
              const asteroid = objects.get(entity.id) || createAsteroid();

              asteroid.x = entity.x;
              asteroid.y = entity.y;
              asteroid.rotation = entity.angle;

              if (!objects.has(entity.id)) {
                objects.set(entity.id, asteroid);
                camera.addChild(asteroid);
                // console.log("spawned", entity.type, entity.id);
              }
            }
          }

          for (const [id, object] of objects) {
            if (!currentObjectsIds.has(id)) {
              objects.delete(id);
              camera.removeChild(object);
              console.log("despawned", id);
            }
          }

          stats().setObjectsCount(objects.size);

          break;
      }
    };
  };

  connectToServer();

  const createShip = (isPlayer: boolean) => {
    const ship = new Container();
    const texture = isPlayer ? playerTexture : pirateTexture;
    const sprite = new Sprite({ texture, anchor: 0.5 });
    if (!isPlayer) {
      sprite.tint = 0xa0a0a0;
    }
    ship.addChild(sprite);
    return ship;
  };
  const createAsteroid = () => {
    const asteroid = new Container();
    const sprite = new Sprite({ texture: asteroidTexture, anchor: 0.5 });
    sprite.tint = 0x808080;
    asteroid.addChild(sprite);
    return asteroid;
  };

  app.canvas.style.imageRendering = "pixelated";

  camera.scale.set(1);

  app.ticker.add((time) => {
    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;

    const cameraScale = lerp(camera.scale.x, 2, time.deltaTime * 0.05);

    const { playerObject } = stats();

    if (playerObject) {
      const targetX = playerObject.x * cameraScale - app.screen.width / 2;
      const targetY = playerObject.y * cameraScale - app.screen.height / 2;
      camera.x = -lerp(-camera.x, targetX, time.deltaTime * 0.1);
      camera.y = -lerp(-camera.y, targetY, time.deltaTime * 0.1);
    }

    camera.scale.set(cameraScale);
  });
};
