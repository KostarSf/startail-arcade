import type { System } from "@/shared/ecs";
import { Sprite } from "pixi.js";

import type { ClientServices } from "../types";

/**
 * Displays hint sprites at the viewport edge pointing toward pirates and bullets
 * when they are outside the visible area.
 */
export const HintSystem: System<ClientServices> = {
  id: "hint-system",
  stage: "presentation",
  tick({ services, time }) {
    const { stores, pixi, player, textures, entityIndex } = services;

    // No hints if player doesn't exist
    if (!player.entityId || !player.id) {
      // Clean up all hints
      for (const child of pixi.camera.children) {
        if (child.name?.startsWith("hint-") || child.name?.startsWith("bullet-hint-")) {
          pixi.camera.removeChild(child);
          child.destroy();
        }
      }
      return;
    }

    const playerTransform = stores.transform.get(player.entityId);
    if (!playerTransform) return;

    const camera = pixi.camera;
    const scale = camera.scale.x || 1;
    const renderWidth = pixi.renderWidth;
    const renderHeight = pixi.renderHeight;

    // Calculate viewport bounds in world coordinates
    // Camera position is inverted, so world position is: (screenCenter - camera.x) / scale
    const screenCenterX = renderWidth / 2;
    const screenCenterY = renderHeight / 2;
    const cameraWorldX = (screenCenterX - camera.x) / scale;
    const cameraWorldY = (screenCenterY - camera.y) / scale;
    const viewWidth = renderWidth / scale;
    const viewHeight = renderHeight / scale;

    const viewportLeft = cameraWorldX - viewWidth / 2;
    const viewportRight = cameraWorldX + viewWidth / 2;
    const viewportTop = cameraWorldY - viewHeight / 2;
    const viewportBottom = cameraWorldY + viewHeight / 2;

    // Track active hint sprites
    const activeHintNames = new Set<string>();
    const activeBulletHintNames = new Set<string>();

    // Helper function to calculate edge intersection and position hint
    const calculateHintPosition = (
      targetX: number,
      targetY: number,
      distanceMultiplier: number
    ): { x: number; y: number; rotation: number } | null => {
      const dx = targetX - playerTransform.x;
      const dy = targetY - playerTransform.y;
      const distance = Math.hypot(dx, dy);

      if (distance === 0) return null;

      // Normalize direction
      const dirX = dx / distance;
      const dirY = dy / distance;

      // Find intersection point with viewport edge
      let edgeDistance = Infinity;
      let edgeX = 0;
      let edgeY = 0;

      // Check intersection with left edge
      if (dirX !== 0) {
        const t = (viewportLeft - playerTransform.x) / dirX;
        if (t > 0) {
          const y = playerTransform.y + dirY * t;
          if (y >= viewportTop && y <= viewportBottom && t < edgeDistance) {
            edgeDistance = t;
            edgeX = viewportLeft;
            edgeY = y;
          }
        }
      }

      // Check intersection with right edge
      if (dirX !== 0) {
        const t = (viewportRight - playerTransform.x) / dirX;
        if (t > 0) {
          const y = playerTransform.y + dirY * t;
          if (y >= viewportTop && y <= viewportBottom && t < edgeDistance) {
            edgeDistance = t;
            edgeX = viewportRight;
            edgeY = y;
          }
        }
      }

      // Check intersection with top edge
      if (dirY !== 0) {
        const t = (viewportTop - playerTransform.y) / dirY;
        if (t > 0) {
          const x = playerTransform.x + dirX * t;
          if (x >= viewportLeft && x <= viewportRight && t < edgeDistance) {
            edgeDistance = t;
            edgeX = x;
            edgeY = viewportTop;
          }
        }
      }

      // Check intersection with bottom edge
      if (dirY !== 0) {
        const t = (viewportBottom - playerTransform.y) / dirY;
        if (t > 0) {
          const x = playerTransform.x + dirX * t;
          if (x >= viewportLeft && x <= viewportRight && t < edgeDistance) {
            edgeDistance = t;
            edgeX = x;
            edgeY = viewportBottom;
          }
        }
      }

      // Safety check: if no edge intersection found, return null
      if (edgeDistance === Infinity) {
        return null;
      }

      // Calculate distance from player to screen border
      const playerToEdgeDistance = Math.hypot(
        edgeX - playerTransform.x,
        edgeY - playerTransform.y
      );

      // Position hint at specified distance multiplier from player to screen border
      const hintDistance = playerToEdgeDistance * distanceMultiplier;
      const hintWorldX = playerTransform.x + dirX * hintDistance;
      const hintWorldY = playerTransform.y + dirY * hintDistance;

      return {
        x: hintWorldX,
        y: hintWorldY,
        rotation: Math.atan2(dy, dx),
      };
    };

    // Iterate through all entities to find pirates
    for (const [serverId, entityId] of entityIndex.entries()) {
      // Skip player
      if (serverId === player.id) continue;

      const transform = stores.transform.get(entityId);
      const networkState = stores.networkState.get(entityId);

      // Skip if not a ship or missing transform
      if (!transform || !networkState?.state || networkState.state.type !== "ship") {
        continue;
      }

      const pirateX = transform.x;
      const pirateY = transform.y;

      // Check if pirate is outside viewport
      const isOutsideViewport =
        pirateX < viewportLeft ||
        pirateX > viewportRight ||
        pirateY < viewportTop ||
        pirateY > viewportBottom;

      if (!isOutsideViewport) {
        // Pirate is visible, remove hint if it exists
        const hintName = `hint-${serverId}`;
        const existingHint = pixi.camera.getChildByName(hintName);
        if (existingHint) {
          pixi.camera.removeChild(existingHint);
          existingHint.destroy();
        }
        continue;
      }

      // Pirate is outside viewport, show hint
      const hintName = `hint-${serverId}`;
      activeHintNames.add(hintName);

      // Get or create hint sprite
      let hintSprite = pixi.camera.getChildByName(hintName) as Sprite | null;
      if (!hintSprite) {
        hintSprite = new Sprite({
          texture: textures.hint,
          anchor: 0.5,
        });
        hintSprite.name = hintName;
        hintSprite.scale.set(3);
        pixi.camera.addChild(hintSprite);
      }

      // Calculate hint position
      const hintPos = calculateHintPosition(pirateX, pirateY, 0.75);
      if (hintPos) {
        hintSprite.x = hintPos.x;
        hintSprite.y = hintPos.y;
        hintSprite.rotation = hintPos.rotation;
      }
    }

    // Iterate through all entities to find bullets from other players
    for (const [serverId, entityId] of entityIndex.entries()) {
      const transform = stores.transform.get(entityId);
      const networkState = stores.networkState.get(entityId);

      // Skip if not a bullet or missing transform
      if (!transform || !networkState?.state || networkState.state.type !== "bullet") {
        continue;
      }

      // Skip player's own bullets
      const ownerId = (networkState.state as any).ownerId;
      if (ownerId === player.id) {
        continue;
      }

      const bulletX = transform.x;
      const bulletY = transform.y;

      // Check if bullet is outside viewport
      const isOutsideViewport =
        bulletX < viewportLeft ||
        bulletX > viewportRight ||
        bulletY < viewportTop ||
        bulletY > viewportBottom;

      if (!isOutsideViewport) {
        // Bullet is visible, remove hint if it exists
        const bulletHintName = `bullet-hint-${serverId}`;
        const existingHint = pixi.camera.getChildByName(bulletHintName);
        if (existingHint) {
          pixi.camera.removeChild(existingHint);
          existingHint.destroy();
        }
        continue;
      }

      // Bullet is outside viewport, show hint
      const bulletHintName = `bullet-hint-${serverId}`;
      activeBulletHintNames.add(bulletHintName);

      // Get or create bullet hint sprite
      let bulletHintSprite = pixi.camera.getChildByName(bulletHintName) as Sprite | null;
      if (!bulletHintSprite) {
        bulletHintSprite = new Sprite({
          texture: textures.bulletHint,
          anchor: 0.5,
        });
        bulletHintSprite.name = bulletHintName;
        bulletHintSprite.scale.set(2);
        pixi.camera.addChild(bulletHintSprite);
      }

      // Calculate hint position (using 0.6 distance multiplier for bullets)
      const hintPos = calculateHintPosition(bulletX, bulletY, 0.6);
      if (hintPos) {
        bulletHintSprite.x = hintPos.x;
        bulletHintSprite.y = hintPos.y;
        bulletHintSprite.rotation = hintPos.rotation;
      }

      // Discrete flickering effect: toggle between visible (1.0) and dimmed (0.2)
      // Toggle every 250ms (4 times per second)
      const flickerPeriod = 250; // milliseconds
      const flickerState = Math.floor((time / flickerPeriod) % 2);
      bulletHintSprite.alpha = flickerState === 0 ? 1.0 : 0.2;
    }

    // Clean up hints for pirates that no longer exist
    for (const child of pixi.camera.children) {
      if (!child.name?.startsWith("hint-")) continue;
      if (activeHintNames.has(child.name)) continue;
      pixi.camera.removeChild(child);
      child.destroy();
    }

    // Clean up bullet hints that no longer exist
    for (const child of pixi.camera.children) {
      if (!child.name?.startsWith("bullet-hint-")) continue;
      if (activeBulletHintNames.has(child.name)) continue;
      pixi.camera.removeChild(child);
      child.destroy();
    }
  },
};
