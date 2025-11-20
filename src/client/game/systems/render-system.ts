import { view } from "@/shared/ecs";
import type { System } from "@/shared/ecs";
import { Graphics, Sprite, Text } from "pixi.js";

import type { ClientServices } from "../types";

/**
 * Synchronizes PIXI display objects with ECS transforms each frame.
 * Also draws optional debug collider circles using server-provided radius.
 */
export const RenderSystem: System<ClientServices> = {
  id: "render-system",
  stage: "presentation",
  tick({ services, time }) {
    const { stores, debug, pixi, player } = services;
    const drawColliders = debug.drawColliders;
    const activeLabelNames = new Set<string>();

    // Calculate viewport bounds for glare updates
    const camera = pixi.camera;
    const cameraScale = camera.scale.x || 1;
    const renderWidth = pixi.renderWidth;
    const renderHeight = pixi.renderHeight;
    const screenCenterX = renderWidth / 2;
    const screenCenterY = renderHeight / 2;
    const cameraWorldX = (screenCenterX - camera.x) / cameraScale;
    const cameraWorldY = (screenCenterY - camera.y) / cameraScale;
    const viewWidth = renderWidth / cameraScale;
    const viewHeight = renderHeight / cameraScale;
    const viewportLeft = cameraWorldX - viewWidth / 2;
    const viewportRight = cameraWorldX + viewWidth / 2;
    const viewportTop = cameraWorldY - viewHeight / 2;
    const viewportBottom = cameraWorldY + viewHeight / 2;

    // Get player transform for distance calculation
    const playerTransform = player.entityId
      ? stores.transform.get(player.entityId)
      : null;

    for (const [entity, transform, renderable] of view(
      stores.transform,
      stores.renderable
    )) {
      if (!renderable.ref) continue;

      const container = renderable.ref;

      // Sync transform
      container.x = transform.x;
      container.y = transform.y;
      container.rotation = transform.angle;

      // Update glare for bullets
      const networkState = stores.networkState.get(entity);
      if (networkState?.state?.type === "bullet") {
        const glareSprite = container.getChildByName("glare") as Sprite | null;
        if (glareSprite) {
          // Calculate distance to player
          let distanceToPlayer = Infinity;
          if (playerTransform) {
            const dx = transform.x - playerTransform.x;
            const dy = transform.y - playerTransform.y;
            distanceToPlayer = Math.hypot(dx, dy);
          }

          // Calculate distance to nearest screen border
          const distToLeft = transform.x - viewportLeft;
          const distToRight = viewportRight - transform.x;
          const distToTop = transform.y - viewportTop;
          const distToBottom = viewportBottom - transform.y;
          const distanceToBorder = Math.min(
            distToLeft,
            distToRight,
            distToTop,
            distToBottom
          );

          // Calculate glare scale: 0.1 when near player, 1.5 when near/beyond border
          // Scale based on distance to border - far from border (near player) = 0.1, near/beyond border = 1.5
          const borderTransitionDistance = 300; // Distance over which to transition from 0.1 to 1.5

          let glareScale: number;
          if (distanceToBorder <= 0) {
            // Beyond border
            glareScale = 1.5;
          } else {
            // Interpolate between 0.1 (far from border) and 1.5 (near border)
            const t = Math.max(0, Math.min(1, 1 - (distanceToBorder / borderTransitionDistance)));
            glareScale = 0.1 + t * (1.5 - 0.1);
          }

          glareSprite.scale.set(glareScale);
          glareSprite.rotation = -container.rotation; // Counteract container rotation to keep horizontal

          // Discrete flickering: change alpha every 100ms
          const flickerInterval = 100;
          const flickerStep = Math.floor(time / flickerInterval);
          // Use flickerStep as seed for consistent flicker per interval
          const random = ((flickerStep * 9301 + 49297) % 233280) / 233280;
          glareSprite.alpha = 0.5 + random * 0.3; // Min 0.5, max 0.8
        }
      }

      // Debug collider rendering (if we have network state with radius)
      const radius = networkState?.state?.radius;

      const existing = container.getChildByName("debug-collider") as
        | Graphics
        | null;

      // Radius label is attached to the camera so it doesn't rotate with the ship
      const labelName = `debug-radius-${entity}`;
      const existingLabel = pixi.camera.getChildByName(labelName) as
        | Text
        | null;

      if (drawColliders && typeof radius === "number" && radius > 0) {
        // Circle
        let gfx = existing;
        if (!gfx) {
          gfx = new Graphics();
          gfx.name = "debug-collider";
          container.addChild(gfx);
        }
        gfx.clear();
        gfx.circle(0, 0, radius);
        gfx.stroke({ width: 1, color: 0x00ff00, alpha: 0.8 });

        // Radius label (screen-down, not rotating with object)
        let label = existingLabel;
        if (!label) {
          label = new Text({
            text: "",
            style: {
              fill: 0x00ff00,
              fontSize: 10,
            },
          });
          label.name = labelName;
          label.anchor.set(0.5, 0);
          pixi.camera.addChild(label);
        }
        label.text = String(Math.round(radius));
        label.x = container.x;
        label.y = container.y + radius + 4;
        label.rotation = 0;
        label.alpha = 0.8;
        activeLabelNames.add(labelName);
      } else {
        if (existing) {
          container.removeChild(existing);
          existing.destroy();
        }
        if (existingLabel) {
          pixi.camera.removeChild(existingLabel);
          existingLabel.destroy();
        }
      }
    }

    // World Border Debug
    const worldBorderName = "debug-world-border";
    let worldBorder = pixi.camera.getChildByName(worldBorderName) as Graphics | null;

    if (debug.drawWorldBorder) {
      if (!worldBorder) {
        worldBorder = new Graphics();
        worldBorder.name = worldBorderName;
        pixi.camera.addChild(worldBorder);
      }
      worldBorder.clear();
      const r = services.world.radius;
      worldBorder.rect(-r, -r, r * 2, r * 2);
      worldBorder.stroke({ width: 4, color: 0xff0000, alpha: 0.5 });
    } else {
      if (worldBorder) {
        pixi.camera.removeChild(worldBorder);
        worldBorder.destroy();
      }
    }

    // Clean up any radius labels whose entities are gone
    for (const child of pixi.camera.children) {
      if (!(child instanceof Text)) continue;
      const name = child.name;
      if (!name || !name.startsWith("debug-radius-")) continue;
      if (activeLabelNames.has(name)) continue;
      pixi.camera.removeChild(child);
      child.destroy();
    }
  },
};
