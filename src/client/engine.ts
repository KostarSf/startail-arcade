// description: This example demonstrates how to use a Container to group and manipulate multiple sprites
import { Application, Assets, Container, Sprite } from "pixi.js";

import type { NetworkEvent } from "@/shared/network/events";
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

  const mousePos = { x: 0, y: 0 };
  app.stage.on("pointermove", (event) => {
    mousePos.x = Math.floor((event.global.x - camera.x) / camera.scale.x);
    mousePos.y = Math.floor((event.global.y - camera.y) / camera.scale.y);

    if (playerObject) {
      // get angle between mousePos and playerObject
      const angle = Math.atan2(
        mousePos.y - playerObject.y,
        mousePos.x - playerObject.x
      );

      playerObject.rotation = angle;

      // send angle to server
      ws.send(
        JSON.stringify({
          type: "player:input",
          input: { angle },
        } as NetworkEvent)
      );
    }
  });

  // Load the bunny texture
  const playerTexture = await Assets.load(player);
  const pirateTexture = await Assets.load(pirate);

  let playerId: string | null = null;
  let playerObject: Container | null = null;

  const objects = new Map<string, Container>();

  const ws = new WebSocket("ws://localhost:3000/ws");

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

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as NetworkEvent;
    switch (message.type) {
      case "player:set-id":
        playerId = message.id;
        break;
      case "server:state":
        const currentObjectsIds = new Set(
          message.entities.map((entity) => entity.id)
        );

        for (const entity of message.entities) {
          if (entity.type === "ship") {
            const ship =
              objects.get(entity.id) || createShip(entity.id === playerId);

            if (entity.id === playerId) {
              playerObject = ship;
            }

            ship.x = Math.round(entity.x);
            ship.y = Math.round(entity.y);
            ship.rotation = entity.angle;

            if (!objects.has(entity.id)) {
              objects.set(entity.id, ship);
              camera.addChild(ship);
              console.log("spawned", entity.id);
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

        break;
    }
  };

  app.canvas.style.imageRendering = "pixelated";

  camera.scale.set(1);

  app.ticker.add((time) => {
    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;

    const cameraScale = lerp(camera.scale.x, 2, time.deltaTime * 0.05);

    if (playerObject) {
      const targetX = playerObject.x * cameraScale - app.screen.width / 2;
      const targetY = playerObject.y * cameraScale - app.screen.height / 2;
      camera.x = -lerp(-camera.x, targetX, time.deltaTime * 0.1);
      camera.y = -lerp(-camera.y, targetY, time.deltaTime * 0.1);
    }

    camera.scale.set(cameraScale);
  });
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
