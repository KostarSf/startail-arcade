import type { System } from "@/shared/ecs";
import type { ShipControlComponent } from "@/shared/ecs/components";
import { createBulletSpawnFromShip } from "@/shared/game/entities/ship";
import { Container, Sprite } from "pixi.js";

import type { ClientServices } from "../types";

const defaultControl = (): ShipControlComponent => ({
  thrust: false,
  angle: 0,
  fire: false,
  lastServerSequence: -1,
  pendingInputs: [],
});

// Shake parameters
const FIRE_SHAKE_AMPLITUDE = 6;
const FIRE_SHAKE_DURATION = 0.2;

// Angle packet throttling constants
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
 * Captures local inputs, updates the local player ship, and queues network commands.
 * Also handles immediate client-side spawning of projectiles for responsiveness.
 */
export const InputSystem: System<ClientServices> = {
  id: "input-system",
  stage: "input",
  tick({ services, time, entities }) {
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

    const sendFields = new Set<"thrust" | "angle" | "fire">();

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

      if (command.fire) {
        // Spawn local projectile
        const shipState = {
          ...transform!,
          vx: stores.velocity.get(player.entityId)!.vx,
          vy: stores.velocity.get(player.entityId)!.vy,
          va: 0,
          type: "ship",
          id: player.id,
          thrust: shipControl.thrust,
        };
        const spawn = createBulletSpawnFromShip(shipState);
        const bulletId = entities.create();

        stores.transform.set(bulletId, {
          x: spawn.x,
          y: spawn.y,
          angle: spawn.angle,
        });
        stores.velocity.set(bulletId, {
          vx: spawn.vx,
          vy: spawn.vy,
          va: 0,
        });

        // Create renderable
        const container = new Container();
        const sprite = new Sprite({
          texture: services.textures.bullet,
          anchor: 0.5,
        });
        container.addChild(sprite);
        services.pixi.camera.addChild(container);
        stores.renderable.set(bulletId, { ref: container, depth: 0 });

        // Mark as local projectile
        stores.localProjectile.set(bulletId, {
          spawnTime: command.timestamp,
          ownerId: player.id,
        });

        // Add to unlinked queue
        services.unlinkedProjectiles.push(bulletId);
      }
    }

    controls.fire = false;
    shipControl.fire = false;
  },
};
