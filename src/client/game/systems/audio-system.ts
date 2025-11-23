/**
 * Audio System - Updates listener position and handles gameplay-driven audio triggers
 */

import type { System } from "@/shared/ecs";
import { view } from "@/shared/ecs";

import type { ClientServices } from "../types";

// Track player state for transitions
let wasPlayerAlive = false;
// Track thrusting state per entity (by server ID)
const thrustingState = new Map<string, boolean>();
// Track active bullet engine sounds per bullet server ID
const bulletSoundState = new Map<string, boolean>();

export const AudioSystem: System<ClientServices> = {
  id: "audio-system",
  stage: "presentation",
  priority: 10, // Run after camera system to use camera position
  tick({ services, dt }) {
    const { audio, pixi, player, stores, stats, entityIndex } = services;

    // Update listener position from camera center in world space
    const camera = pixi.camera;
    const renderWidth = pixi.renderWidth;
    const renderHeight = pixi.renderHeight;
    const cameraScale = camera.scale.x;
    const screenCenterX = renderWidth / 2;
    const screenCenterY = renderHeight / 2;
    const cameraWorldX = (screenCenterX - camera.x) / cameraScale;
    const cameraWorldY = (screenCenterY - camera.y) / cameraScale;

    // Calculate camera velocity for Doppler
    // This is a simple approximation - in a real implementation, you'd track previous position
    let cameraVelX = 0;
    let cameraVelY = 0;

    // For now, use player velocity as approximation for camera velocity
    if (player.entityId !== null) {
      const playerVelocity = stores.velocity.get(player.entityId);
      if (playerVelocity) {
        cameraVelX = playerVelocity.vx;
        cameraVelY = playerVelocity.vy;
      }
    }

    // Update audio listener
    audio.updateListener(
      { x: cameraWorldX, y: cameraWorldY },
      { vx: cameraVelX, vy: cameraVelY }
    );

    // Update space ambience pitch slightly based on camera speed
    const cameraSpeed = Math.hypot(cameraVelX, cameraVelY);
    // Normalize speed to [0, 1] over a reasonable range (0–400 units/sec)
    const speedNorm = Math.min(cameraSpeed / 400, 1);
    // Base pitch around 1.0, add up to +10% with speed
    const ambiencePitch = 1 + speedNorm * 0.1;
    audio.setLoopingPitch({
      soundId: "space_ambience",
      entityId: "ambient",
      pitch: ambiencePitch,
    });

    // Handle player alive/dead state transitions for music
    const isPlayerAlive = player.entityId !== null;
    if (isPlayerAlive !== wasPlayerAlive) {
      if (isPlayerAlive) {
        // Player just spawned/respawned
        audio.playMusic({
          musicId: "msg_song",
          loop: true,
          fadeInMs: 1000,
        });
        audio.playOneShot({ soundId: "snd_revive" });
      } else {
        // Player just died
        audio.stopMusic({
          musicId: "msg_song",
          fadeOutMs: 1000,
        });
      }
      wasPlayerAlive = isPlayerAlive;
    }

    // Handle engine sounds for all ships (including player and enemies)
    // Track which ships should have engine sounds based on their thrust state
    const currentlyThrusting = new Set<string>();

    // Iterate through all ships in the world
    for (const [serverId, entityId] of entityIndex.entries()) {
      const networkState = stores.networkState.get(entityId);
      if (!networkState?.state || networkState.state.type !== "ship") {
        continue;
      }

      const shipControl = stores.shipControl.get(entityId);
      const transform = stores.transform.get(entityId);
      const velocity = stores.velocity.get(entityId);

      if (!shipControl || !transform || !velocity) {
        continue;
      }

      const isThrusting = shipControl.thrust ?? false;
      const wasThrusting = thrustingState.get(serverId) ?? false;
      const isPlayer = serverId === player.id;

      if (isThrusting !== wasThrusting) {
        if (isThrusting) {
          // Start engine sound for this ship
          currentlyThrusting.add(serverId);

          if (isPlayer) {
            // Player's engine sound is non-positional
            audio.playLoopingSound({
              soundId: "snd_engine",
              entityId: serverId,
              nonPositional: true,
            });
          } else {
            // Enemy ships' engine sounds are positional
            audio.playLoopingSound({
              soundId: "snd_engine",
              entityId: serverId,
              position: { x: transform.x, y: transform.y },
              velocity: { vx: velocity.vx, vy: velocity.vy },
            });
          }
        } else {
          // Stop engine sound for this ship
          audio.stopLoopingSound("snd_engine", serverId);
        }
        thrustingState.set(serverId, isThrusting);
      } else if (isThrusting) {
        // Ship is still thrusting - update position/velocity for positional sounds
        currentlyThrusting.add(serverId);

        if (!isPlayer) {
          // Update enemy ship's engine sound position/velocity
          audio.updateLoopingSound({
            soundId: "snd_engine",
            entityId: serverId,
            position: { x: transform.x, y: transform.y },
            velocity: { vx: velocity.vx, vy: velocity.vy },
          });
        }
      }
    }

    // Stop engine sounds for ships that are no longer thrusting or no longer exist
    for (const [serverId, wasThrusting] of thrustingState.entries()) {
      if (!currentlyThrusting.has(serverId)) {
        audio.stopLoopingSound("snd_engine", serverId);
        thrustingState.delete(serverId);
      }
    }

    // Clean up engine sounds for entities that no longer exist
    for (const [serverId] of thrustingState.entries()) {
      if (!entityIndex.has(serverId)) {
        audio.stopLoopingSound("snd_engine", serverId);
        thrustingState.delete(serverId);
      }
    }

    // Handle enemy bullet engine hum (tiny positional snd_engine sound with higher pitch)
    const activeBulletIds = new Set<string>();

    for (const [serverId, entityId] of entityIndex.entries()) {
      const transform = stores.transform.get(entityId);
      const networkState = stores.networkState.get(entityId);
      const velocity = stores.velocity.get(entityId);

      // Skip if not a bullet or missing data
      if (!transform || !networkState?.state || networkState.state.type !== "bullet" || !velocity) {
        continue;
      }

      // Skip player's own bullets
      const ownerId = (networkState.state as any).ownerId as string | undefined;
      if (ownerId === player.id) {
        continue;
      }

      const bulletId = serverId;
      activeBulletIds.add(bulletId);

      const hasSound = bulletSoundState.get(bulletId) ?? false;

      if (!hasSound) {
        // Start tiny positional engine hum for this enemy bullet.
        // Volume and base pitch are tuned via SOUND_REGISTRY (snd_engine_bullet).
        audio.playLoopingSound({
          soundId: "snd_engine_bullet",
          entityId: bulletId,
          position: { x: transform.x, y: transform.y },
          velocity: { vx: velocity.vx, vy: velocity.vy },
        });
        bulletSoundState.set(bulletId, true);
      } else {
        // Update position/velocity for existing bullet sound
        audio.updateLoopingSound({
          soundId: "snd_engine_bullet",
          entityId: bulletId,
          position: { x: transform.x, y: transform.y },
          velocity: { vx: velocity.vx, vy: velocity.vy },
        });
      }
    }

    // Stop bullet sounds for bullets that no longer exist
    for (const [bulletId] of bulletSoundState.entries()) {
      if (!activeBulletIds.has(bulletId)) {
        audio.stopLoopingSound("snd_engine_bullet", bulletId);
        bulletSoundState.delete(bulletId);
      }
    }

    // Handle explosion effects from effect queue (visual only)
    // Explosion sounds are now played immediately in ClientEngine.#handleMessage
    // This queue is just for visual effects
    while (services.effectQueues.explosions.length > 0) {
      // Just remove from queue - sounds are played immediately on event
      services.effectQueues.explosions.shift();
    }
  },
};
