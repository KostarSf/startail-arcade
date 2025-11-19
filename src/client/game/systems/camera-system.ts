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

// Speed threshold for continuous shake (from 50)
const SPEED_SHAKE_THRESHOLD = 50;

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
      cameraShake,
    } = services;

    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;

    if (player.entityId === null) return;

    const transform = stores.transform.get(player.entityId);
    const velocity = stores.velocity.get(player.entityId);
    const shipControl = stores.shipControl.get(player.entityId);
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

    // Continuous shake when moving fast (speed >= 50)
    // Amplitude scales with speed from 0 (at 50) to very small (at max speed)
    if (speed >= SPEED_SHAKE_THRESHOLD) {
      const speedShakeAmplitude = inverseLerp(
        speed,
        SPEED_SHAKE_THRESHOLD,
        MAX_PLAYER_SPEED
      ) * 0.2; // Almost completely removed, max 0.2 pixels
      cameraShake.setContinuousShake(speedShakeAmplitude);
    } else {
      cameraShake.setContinuousShake(0);
    }

    // Continuous shake while accelerating (thrust is active)
    // Amplitude depends on speed and drift
    if (shipControl && shipControl.thrust) {
      // Calculate drift (angle difference between ship facing and velocity direction)
      let drift = 0;
      if (speed > 0.01) {
        const velocityAngle = Math.atan2(velocity.vy, velocity.vx);
        let angleDiff = Math.abs(transform.angle - velocityAngle);
        angleDiff = Math.min(angleDiff, Math.PI * 2 - angleDiff);
        drift = inverseLerp(angleDiff, 0, Math.PI); // 0 = aligned, 1 = perpendicular
      }

      // Base amplitude scales with speed (smaller at low speed)
      const MAX_ACCELERATION_SHAKE_AMPLITUDE = 2; // Max amplitude at high speed
      const MIN_SPEED_FOR_SHAKE = 10; // Minimum speed to start feeling shake
      const speedFactor = inverseLerp(speed, MIN_SPEED_FOR_SHAKE, MAX_PLAYER_SPEED);

      // Drift factor: higher drift = more shake (1.0 base + up to 1.0 from drift)
      const driftFactor = 1.0 + drift; // Range: 1.0 (no drift) to 2.0 (max drift)

      // Final amplitude = base * speed factor * drift factor
      const accelerationShakeAmplitude = MAX_ACCELERATION_SHAKE_AMPLITUDE * speedFactor * driftFactor;

      cameraShake.setAccelerationShake(accelerationShakeAmplitude);
    } else {
      cameraShake.setAccelerationShake(0);
    }

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

    // Update shake and get offset
    const shakeOffset = cameraShake.update(dt);

    camera.x = -lerp(-camera.x, targetX, dt * 6) + shakeOffset.x;
    camera.y = -lerp(-camera.y, targetY, dt * 6) + shakeOffset.y;
    camera.scale.set(newScale);

    starfield.update(
      dt * 1000,
      camera.x,
      camera.y,
      newScale,
      renderWidth,
      renderHeight,
      shakeOffset.x * 0.5,
      shakeOffset.y * 0.5
    );
  },
};
