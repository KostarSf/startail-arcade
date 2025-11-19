import type { System } from "@/shared/ecs";
import { inverseLerp, lerp } from "@/shared/math/utils";

import type { ClientServices } from "../types";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Smoothly follows the player ship, applies auto-zoom, and drives parallax
 * starfield updates based on the active camera transform.
 */
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

    const speed = Math.hypot(velocity.vx, velocity.vy);
    const MIN_CAMERA_ZOOM = 0.7;
    const MAX_CAMERA_ZOOM = 1.7;
    const MAX_PLAYER_SPEED = 350;
    const targetScale = clamp(
      MAX_CAMERA_ZOOM - inverseLerp(speed, 0, MAX_PLAYER_SPEED),
      MIN_CAMERA_ZOOM,
      MAX_CAMERA_ZOOM
    );
    const currentScale = camera.scale.x;
    const newScale = lerp(currentScale, targetScale, dt * 5);

    const renderWidth = services.pixi.renderWidth;
    const renderHeight = services.pixi.renderHeight;

    const targetX = transform.x * newScale - renderWidth / 2;
    const targetY = transform.y * newScale - renderHeight / 2;

    camera.x = -lerp(-camera.x, targetX, dt * 6);
    camera.y = -lerp(-camera.y, targetY, dt * 6);
    camera.scale.set(newScale);

    starfield.update(
      dt * 1000,
      camera.x,
      camera.y,
      newScale,
      renderWidth,
      renderHeight
    );
  },
};
