import type { System } from "@/shared/ecs";
import { inverseLerp, lerp } from "@/shared/math/utils";

import type { ClientServices } from "../types";

type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const averagePoint = (points: Point[]): Point => {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
};

const clampPointToRadius = (
  origin: Point,
  target: Point,
  maxRadius: number
): Point => {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0 || distance <= maxRadius) {
    return target;
  }

  const scale = maxRadius / distance;
  return {
    x: origin.x + dx * scale,
    y: origin.y + dy * scale,
  };
};

const MAX_CAMERA_TARGET_RADIUS = 100;
const MOVING_SPEED_THRESHOLD = 10;

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
      controls,
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

    const cursorWorld =
      controls.cursorWorld ?? {
        x: transform.x,
        y: transform.y,
      };

    const renderWidth = services.pixi.renderWidth;
    const renderHeight = services.pixi.renderHeight;

    const shipTarget: Point =
      speed > MOVING_SPEED_THRESHOLD
        ? {
            x: transform.x + velocity.vx,
            y: transform.y + velocity.vy,
          }
        : {
            x: transform.x,
            y: transform.y,
          };

    // Calculate center point on ship-cursor segment, then average with ship position
    // This gives cursor half the influence (25% instead of 50%)
    const shipCursorMidpoint: Point = {
      x: (shipTarget.x + cursorWorld.x) / 2,
      y: (shipTarget.y + cursorWorld.y) / 2,
    };
    const averagedTarget = averagePoint([shipTarget, shipCursorMidpoint]);
    const clampedTarget = clampPointToRadius(
      { x: transform.x, y: transform.y },
      averagedTarget,
      MAX_CAMERA_TARGET_RADIUS
    );

    const targetX = clampedTarget.x * newScale - renderWidth / 2;
    const targetY = clampedTarget.y * newScale - renderHeight / 2;

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
