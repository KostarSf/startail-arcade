import type { System } from "@/shared/ecs";
import type { ShipControlComponent } from "@/shared/ecs/components";

import type { ClientServices } from "../types";

const defaultControl = (): ShipControlComponent => ({
  thrust: false,
  angle: 0,
  fire: false,
  lastServerSequence: -1,
  pendingInputs: [],
});

// Shake parameters
const FIRE_SHAKE_AMPLITUDE = 6; // Increased amplitude for more noticeable fire shake
const FIRE_SHAKE_DURATION = 0.2; // Slightly longer duration (150ms)

// Angle packet throttling
const ANGLE_PACKET_INTERVAL_MS = 1000 / 60; // ~60hz
const ANGLE_EPSILON = (Math.PI / 180) * 0.25; // 0.25 degree
const ANGLE_FORCE_THRESHOLD = (Math.PI / 180) * 5; // 5 degrees

const normalizeAngleDelta = (current: number, previous: number) => {
  let delta = current - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

/**
 * Captures local controls, mutates the player's ship component immediately,
 * and emits buffered commands to the network layer for reconciliation.
 */
// Track previous staticCamera state to detect changes
let previousStaticCamera = false;

export const InputSystem: System<ClientServices> = {
  id: "input-system",
  stage: "input",
  tick({ services, time }) {
    const {
      player,
      controls,
      stores,
      network,
      inputBuffer,
      pixi,
      cameraShake,
    } = services;
    if (!player.id || player.entityId === null) return;

    const screenCursor =
      controls.cursorScreen ?? {
        x: pixi.renderWidth / 2,
        y: pixi.renderHeight / 2,
      };

    const cursorWorld = {
      x: (screenCursor.x - pixi.camera.x) / pixi.camera.scale.x,
      y: (screenCursor.y - pixi.camera.y) / pixi.camera.scale.y,
    };

    controls.cursorWorld = cursorWorld;

    const shipControl = stores.shipControl.ensure(
      player.entityId,
      defaultControl
    );
    const transform = stores.transform.get(player.entityId);

    if (transform) {
      controls.angle =
        Math.atan2(cursorWorld.y - transform.y, cursorWorld.x - transform.x) ??
        controls.angle;
      transform.angle = controls.angle;
    }

    const previousAngle = shipControl.angle;
    const angleDelta = normalizeAngleDelta(controls.angle, previousAngle);
    const angleChanged = Math.abs(angleDelta) > ANGLE_EPSILON;
    if (angleChanged) {
      shipControl.angle = controls.angle;
    }

    const thrustChanged = shipControl.thrust !== controls.thrust;
    if (thrustChanged) {
      shipControl.thrust = controls.thrust;
    }

    const fireTriggered = controls.fire;
    if (fireTriggered) {
      shipControl.fire = true;
      cameraShake.add(FIRE_SHAKE_AMPLITUDE, FIRE_SHAKE_DURATION);

      // Play shoot sound
      const transform = stores.transform.get(player.entityId);
      const velocity = stores.velocity.get(player.entityId);
      const networkState = stores.networkState.get(player.entityId);

      // Check if player has enough energy to fire (client-side check for sound feedback)
      const shipState = networkState?.state?.type === "ship" ? networkState.state : null;
      const energy = shipState?.energy ?? shipState?.maxEnergy ?? 100;
      const energyConsumption = 25; // Approximate energy cost per shot (should match server)

      if (energy >= energyConsumption) {
        // Play shoot sound (non-positional for player)
        services.audio.playOneShot({
          soundId: "snd_shoot",
          // No position - player's fire sound is non-positional (centered)
        });
      } else {
        // Not enough energy - play out of ammo sound
        services.audio.playOneShot({ soundId: "snd_out_of_ammo" });
      }
    }

    if (angleChanged) {
      controls.pendingAngle = shipControl.angle;
    }

    const now = time;
    const timeSinceLastAngle = now - controls.lastAnglePacketTime;
    const hasPendingAngle =
      typeof controls.pendingAngle === "number" &&
      Number.isFinite(controls.pendingAngle);
    const shouldForceAngleSend =
      Math.abs(
        normalizeAngleDelta(
          controls.pendingAngle ?? shipControl.angle,
          controls.lastSentAngle
        )
      ) >= ANGLE_FORCE_THRESHOLD;
    const angleThrottleElapsed = timeSinceLastAngle >= ANGLE_PACKET_INTERVAL_MS;

    const staticCameraChanged = controls.staticCamera !== previousStaticCamera;
    if (staticCameraChanged) {
      previousStaticCamera = controls.staticCamera;
    }

    // firingCompensation is the inverse of staticCamera
    // Only send when true (when staticCamera is false)
    const firingCompensation = !controls.staticCamera;

    const sendFields = new Set<"thrust" | "angle" | "fire" | "firingCompensation">();

    if (thrustChanged) {
      sendFields.add("thrust");
      if (hasPendingAngle) {
        sendFields.add("angle");
      }
    }

    if (fireTriggered) {
      sendFields.add("fire");
      sendFields.add("angle"); // keep server angle in sync when firing
    }

    // Send firingCompensation only when it's true (when staticCamera is false)
    if (firingCompensation) {
      sendFields.add("firingCompensation");
    }

    if (!thrustChanged && !fireTriggered && hasPendingAngle) {
      if (angleThrottleElapsed || shouldForceAngleSend) {
        sendFields.add("angle");
      }
    }

    if (sendFields.size === 0) {
      return;
    }

    const command = network.sendInput(
      {
        thrust: shipControl.thrust,
        angle: shipControl.angle,
        fire: shipControl.fire,
        firingCompensation: firingCompensation,
      },
      { fields: Array.from(sendFields) }
    );

    if (command) {
      inputBuffer.enqueue(command);
      if (sendFields.has("angle")) {
        controls.lastAnglePacketTime = now;
        controls.lastSentAngle = shipControl.angle;
        controls.pendingAngle = null;
      }
    }

    controls.fire = false;
    shipControl.fire = false;
  },
};
