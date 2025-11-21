import type { System } from "@/shared/ecs";
import { inverseLerp, lerp } from "@/shared/math/utils";

import type { ClientServices } from "../types";

type Point = { x: number; y: number };

interface CameraTarget {
  x: number;
  y: number;
  scale: number;
}

// Time in seconds to reach target (0 = instant, 0.1 = 100ms, etc.)
let TARGET_POSITION_LERP_TIME = 0.2; // seconds
let TARGET_SCALE_LERP_TIME = 0.2; // seconds

// Initial target values
const INITIAL_TARGET_X = 0;
const INITIAL_TARGET_Y = 0;
const INITIAL_TARGET_SCALE = 1;

// Shake constants
const SPEED_SHAKE_THRESHOLD = 50;
const MAX_PLAYER_SPEED = 500;
const MAX_ACCELERATION_SHAKE_AMPLITUDE = 2;
const MIN_SPEED_FOR_SHAKE = 10;

// Zoom constants
const MAX_ZOOM_WHEN_STILL = 1.9;
const MIN_ZOOM_WHEN_MOVING = 1.3;
const PLAYER_SPEED_FOR_MIN_ZOOM = 350; // Speed at which zoom becomes minimal

// Cursor tracking constants
const CURSOR_INFLUENCE_FACTOR = 0.3; // How much cursor affects target (40%)
const MAX_CURSOR_OFFSET_DISTANCE = 80; // Maximum distance cursor can offset target

// Velocity tracking constants
const VELOCITY_INFLUENCE_FACTOR = 0.4; // How much velocity affects target
const MAX_VELOCITY_OFFSET_DISTANCE = 200; // Maximum distance velocity can offset target

// Camera target state
let cameraTarget: CameraTarget = {
  x: INITIAL_TARGET_X,
  y: INITIAL_TARGET_Y,
  scale: INITIAL_TARGET_SCALE,
};

// Track if camera has been initialized
let cameraInitialized = false;

// Track last player position to detect warping
let lastPlayerPosition: Point | null = null;

// Track player death position to keep camera target there until respawn
let deathPosition: Point | null = null;
let wasPlayerAlive = false;

/**
 * Clamps a point's magnitude to a maximum distance while preserving direction.
 * @param point - Point to clamp
 * @param maxMagnitude - Maximum magnitude
 * @returns Clamped point
 */
function clampPointMagnitude(point: Point, maxMagnitude: number): Point {
  const magnitude = Math.hypot(point.x, point.y);
  if (magnitude === 0 || magnitude <= maxMagnitude) {
    return point;
  }
  const scale = maxMagnitude / magnitude;
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

/**
 * Calculates camera zoom value based on current player speed.
 * Uses linear interpolation between max zoom (when still) and min zoom (when moving).
 * @param currentSpeed - Current player speed
 * @param targetSpeed - Target speed at which zoom becomes minimal
 * @param dt - Delta time in seconds
 * @param currentZoom - Current zoom value to lerp from
 * @returns Zoom value between MIN_ZOOM_WHEN_MOVING and MAX_ZOOM_WHEN_STILL
 */
function calculateZoomFromSpeed(
  currentSpeed: number,
  targetSpeed: number,
  dt: number,
  currentZoom: number
): number {
  // Clamp speed to [0, targetSpeed] for interpolation
  const clampedSpeed = Math.max(0, Math.min(currentSpeed, targetSpeed));

  // Linear interpolation: 0 speed = max zoom, targetSpeed = min zoom
  const t = clampedSpeed / targetSpeed;
  const targetZoom = lerp(MAX_ZOOM_WHEN_STILL, MIN_ZOOM_WHEN_MOVING, t);


  const scaleLerpFactor = Math.min(1 - Math.exp(-dt / 0.03), 1);

  // Lerp from current zoom to target zoom
  // For now, use lerp factor of 1 (instant) to preserve same behavior
  return lerp(currentZoom, targetZoom, scaleLerpFactor);
}

/**
 * Updates the camera target based on current player state and actions.
 * This function defines the behavior of where the camera should focus.
 * @param services - Client services
 * @param dt - Delta time in seconds
 * @param currentZoom - Current camera zoom value
 */
function updateCameraTarget(services: ClientServices, dt: number, currentZoom: number): void {
  const { player, stores } = services;

  if (player.entityId === null) {
    // Player is dead or not spawned - reset target scale to initial
    cameraTarget.scale = INITIAL_TARGET_SCALE;

    // Keep target position at death position until respawn
    if (deathPosition) {
      cameraTarget.x = deathPosition.x;
      cameraTarget.y = deathPosition.y;
    }
    return;
  }

  // Player is on stage - update target based on player's current state
  const transform = stores.transform.get(player.entityId);
  const velocity = stores.velocity.get(player.entityId);
  const shipControl = stores.shipControl.get(player.entityId);

  if (!transform) {
    return;
  }

  // If player just respawned (was dead, now alive), clear death position
  if (deathPosition !== null) {
    deathPosition = null;
  }

  // Calculate target position with cursor tracking
  const shipPosition: Point = { x: transform.x, y: transform.y };

  // Get cursor world position, fallback to ship position if not available
  const cursorWorld = services.controls.cursorWorld ?? shipPosition;

  // Calculate difference vector: (ship_position - cursor_position) * influence_factor
  const shipCursorDifference: Point = {
    x: (shipPosition.x - cursorWorld.x) * CURSOR_INFLUENCE_FACTOR,
    y: (shipPosition.y - cursorWorld.y) * CURSOR_INFLUENCE_FACTOR,
  };

  // Clamp the difference magnitude to maximum offset distance
  const clampedCursorDifference = clampPointMagnitude(
    shipCursorDifference,
    MAX_CURSOR_OFFSET_DISTANCE
  );

  // Calculate velocity offset
  let velocityOffset: Point = { x: 0, y: 0 };
  if (velocity) {
    // Calculate velocity offset: velocity * influence_factor
    // (velocity already contains direction and speed)
    const velocityOffsetRaw: Point = {
      x: velocity.vx * VELOCITY_INFLUENCE_FACTOR,
      y: velocity.vy * VELOCITY_INFLUENCE_FACTOR,
    };

    // Clamp velocity offset magnitude to maximum distance
    velocityOffset = clampPointMagnitude(
      velocityOffsetRaw,
      MAX_VELOCITY_OFFSET_DISTANCE
    );
  }

  // Target position = ship position + cursor offset + velocity offset
  cameraTarget.x =
    shipPosition.x -
    clampedCursorDifference.x / cameraTarget.scale +
    velocityOffset.x / cameraTarget.scale;
  cameraTarget.y =
    shipPosition.y -
    clampedCursorDifference.y / cameraTarget.scale +
    velocityOffset.y / cameraTarget.scale;

  // Calculate zoom based on player speed
  if (velocity) {
    const speed = Math.hypot(velocity.vx, velocity.vy);
    cameraTarget.scale = calculateZoomFromSpeed(
      speed,
      PLAYER_SPEED_FOR_MIN_ZOOM,
      dt,
      currentZoom
    );
  } else {
    // If no velocity, lerp to max zoom (still)
    cameraTarget.scale = lerp(currentZoom, MAX_ZOOM_WHEN_STILL, 1);
  }
}

/**
 * Updates shake amplitudes based on player state and actions.
 */
function updateShakeAmplitudes(services: ClientServices): void {
  const { player, stores, cameraShake } = services;

  if (player.entityId === null) {
    // Disable shake when player is dead
    cameraShake.setContinuousShake(0);
    cameraShake.setAccelerationShake(0);
    return;
  }

  const transform = stores.transform.get(player.entityId);
  const velocity = stores.velocity.get(player.entityId);
  const shipControl = stores.shipControl.get(player.entityId);

  if (!velocity) {
    return;
  }

  const speed = Math.hypot(velocity.vx, velocity.vy);

  // Continuous shake when moving fast
  if (speed >= SPEED_SHAKE_THRESHOLD) {
    const speedShakeAmplitude =
      inverseLerp(speed, SPEED_SHAKE_THRESHOLD, MAX_PLAYER_SPEED) * 0.2;
    cameraShake.setContinuousShake(speedShakeAmplitude);
  } else {
    cameraShake.setContinuousShake(0);
  }

  // Acceleration shake while thrusting
  if (shipControl && shipControl.thrust && transform) {
    // Calculate drift (angle difference between ship facing and velocity direction)
    let drift = 0;
    if (speed > 0.01) {
      const velocityAngle = Math.atan2(velocity.vy, velocity.vx);
      let angleDiff = Math.abs(transform.angle - velocityAngle);
      angleDiff = Math.min(angleDiff, Math.PI * 2 - angleDiff);
      drift = inverseLerp(angleDiff, 0, Math.PI); // 0 = aligned, 1 = perpendicular
    }

    const speedFactor = inverseLerp(speed, MIN_SPEED_FOR_SHAKE, MAX_PLAYER_SPEED);
    const driftFactor = 1.0 + drift; // Range: 1.0 (no drift) to 2.0 (max drift)
    const accelerationShakeAmplitude =
      MAX_ACCELERATION_SHAKE_AMPLITUDE * speedFactor * driftFactor;

    cameraShake.setAccelerationShake(accelerationShakeAmplitude);
  } else {
    cameraShake.setAccelerationShake(0);
  }
}

/**
 * Camera system that smoothly follows a target position and scale,
 * applies shake effects, and updates the starfield.
 */
export const CameraSystem: System<ClientServices> = {
  id: "camera-system",
  stage: "presentation",
  priority: 2,
  tick({ services, dt }) {
    const {
      pixi: { app, camera, starfield },
      cameraShake,
    } = services;

    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;

    const renderWidth = services.pixi.renderWidth;
    const renderHeight = services.pixi.renderHeight;

    // Skip if dimensions are not ready yet
    if (renderWidth === 0 || renderHeight === 0) {
      return;
    }

    // Detect if player just died and capture death position
    const isPlayerAlive = services.player.entityId !== null;

    // If player just died (was alive, now dead), capture death position
    if (wasPlayerAlive && !isPlayerAlive) {
      // Use last known position from previous frame
      if (lastPlayerPosition) {
        deathPosition = { x: lastPlayerPosition.x, y: lastPlayerPosition.y };
      }
    }

    wasPlayerAlive = isPlayerAlive;

    // Update camera target based on player state and actions
    const currentZoom = camera.scale.x;
    updateCameraTarget(services, dt, currentZoom);

    // Update shake amplitudes based on player state
    updateShakeAmplitudes(services);

    // Detect if player warped (teleported to other side of game field)
    let playerWarped = false;
    let playerWarpDelta: Point | null = null;
    if (services.player.entityId !== null) {
      const transform = services.stores.transform.get(services.player.entityId);
      if (transform && lastPlayerPosition) {
        const dx = transform.x - lastPlayerPosition.x;
        const dy = transform.y - lastPlayerPosition.y;
        const distance = Math.hypot(dx, dy);
        // If player moved more than world radius, they warped
        if (distance > services.world.radius) {
          playerWarped = true;
          playerWarpDelta = { x: dx, y: dy };
        }
      }
    } else {
      // Reset last position when player dies
      lastPlayerPosition = null;
    }

    // Initialize camera to target position on first frame
    if (!cameraInitialized) {
      const targetCameraX = cameraTarget.x * cameraTarget.scale - renderWidth / 2;
      const targetCameraY = cameraTarget.y * cameraTarget.scale - renderHeight / 2;
      camera.x = -targetCameraX;
      camera.y = -targetCameraY;
      camera.scale.set(cameraTarget.scale);
      cameraInitialized = true;
    } else if (playerWarped && playerWarpDelta) {
      // Player warped - preserve camera's lerping state by applying the same delta
      // Convert current camera screen position to world position
      const currentScale = camera.scale.x;
      const currentCameraWorldX = (-camera.x + renderWidth / 2) / currentScale;
      const currentCameraWorldY = (-camera.y + renderHeight / 2) / currentScale;

      // Apply the player's warp delta to camera world position
      const newCameraWorldX = currentCameraWorldX + playerWarpDelta.x;
      const newCameraWorldY = currentCameraWorldY + playerWarpDelta.y;

      // Convert back to screen coordinates
      camera.x = -(newCameraWorldX * cameraTarget.scale - renderWidth / 2);
      camera.y = -(newCameraWorldY * cameraTarget.scale - renderHeight / 2);
      camera.scale.set(cameraTarget.scale);
    } else {
      // Get current camera world-space center point (before scale change)
      const oldScale = camera.scale.x;
      const currentCameraWorldX = (-camera.x + renderWidth / 2) / oldScale;
      const currentCameraWorldY = (-camera.y + renderHeight / 2) / oldScale;

      // Lerp camera scale to target
      let newScale: number;
      if (TARGET_SCALE_LERP_TIME === 0) {
        // Instant snap
        newScale = cameraTarget.scale;
        camera.scale.set(newScale);
      } else {
        // Exponential decay lerp over specified time
        const scaleLerpFactor = Math.min(1 - Math.exp(-dt / TARGET_SCALE_LERP_TIME), 1);
        newScale = lerp(oldScale, cameraTarget.scale, scaleLerpFactor);
        camera.scale.set(newScale);
      }

      // Adjust camera position to maintain same world-space center when scale changes
      // This prevents bouncing when zoom changes dynamically
      const adjustedCameraX = -(currentCameraWorldX * newScale - renderWidth / 2);
      const adjustedCameraY = -(currentCameraWorldY * newScale - renderHeight / 2);

      // Calculate position target using the new scale
      const targetCameraX = cameraTarget.x * newScale - renderWidth / 2;
      const targetCameraY = cameraTarget.y * newScale - renderHeight / 2;

      // Smoothly lerp camera position to target (starting from adjusted position)
      if (TARGET_POSITION_LERP_TIME === 0) {
        // Instant snap
        camera.x = -targetCameraX;
        camera.y = -targetCameraY;
      } else {
        // Exponential decay lerp over specified time
        const positionLerpFactor = Math.min(1 - Math.exp(-dt / TARGET_POSITION_LERP_TIME), 1);
        camera.x = -lerp(-adjustedCameraX, targetCameraX, positionLerpFactor);
        camera.y = -lerp(-adjustedCameraY, targetCameraY, positionLerpFactor);
      }
    }

    // Update last player position AFTER processing warp
    if (services.player.entityId !== null) {
      const transform = services.stores.transform.get(services.player.entityId);
      if (transform) {
        lastPlayerPosition = { x: transform.x, y: transform.y };
      }
    }

    // Calculate camera's current lerped world position (before shake is applied)
    // This is the smooth position the camera is actually at, not the target
    const currentCameraWorldX = (-camera.x + renderWidth / 2) / camera.scale.x;
    const currentCameraWorldY = (-camera.y + renderHeight / 2) / camera.scale.x;

    // Update shake and get offset
    const shakeOffset = cameraShake.update(dt);

    // Apply shake offset to camera position
    camera.x += shakeOffset.x;
    camera.y += shakeOffset.y;

    // Update starfield with camera's lerped world position (not target) and shake offset
    // This ensures stars move smoothly with the camera, not teleport when target changes
    starfield.update(
      dt * 1000,
      currentCameraWorldX,
      currentCameraWorldY,
      camera.scale.x,
      renderWidth,
      renderHeight,
      shakeOffset.x * 0.5,
      shakeOffset.y * 0.5
    );
  },
};
