import type { System } from "@/shared/ecs";
import { inverseLerp, lerp } from "@/shared/math/utils";

import type { ClientServices } from "../types";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const CameraSystem: System<ClientServices> = {
  id: "camera-system",
  stage: "presentation",
  priority: 2,
  tick({ services, dt }) {
    const {
      pixi: { app, camera, starfield },
      player,
      stores,
    } = services;

    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;

    if (player.entityId === null) return;

    const transform = stores.transform.get(player.entityId);
    const velocity = stores.velocity.get(player.entityId);
    if (!transform || !velocity) return;

    const speed = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2);
    const targetScale = clamp(2 - inverseLerp(speed, 0, 350), 0.5, 2);
    const currentScale = camera.scale.x;
    const newScale = lerp(currentScale, targetScale, dt * 5);

    const targetX = transform.x * newScale - app.screen.width / 2;
    const targetY = transform.y * newScale - app.screen.height / 2;

    camera.x = -lerp(-camera.x, targetX, dt * 6);
    camera.y = -lerp(-camera.y, targetY, dt * 6);
    camera.scale.set(newScale);

    starfield.update(
      dt * 1000,
      camera.x,
      camera.y,
      newScale,
      app.screen.width,
      app.screen.height
    );
  },
};
