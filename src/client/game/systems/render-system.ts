import { view } from "@/shared/ecs";
import type { System } from "@/shared/ecs";
import { Container, Graphics, Sprite, Text } from "pixi.js";

import type { ClientServices } from "../types";
import { syncShadowsInContainer } from "../utils/shadow-utils";

/**
 * Synchronizes PIXI display objects with ECS transforms each frame.
 * Also draws optional debug collider circles using server-provided radius.
 */
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const RenderSystem: System<ClientServices> = {
  id: "render-system",
  stage: "presentation",
  tick({ services, time }) {
    const { stores, debug, pixi, player } = services;
    const drawColliders = debug.drawColliders;
    const activeLabelNames = new Set<string>();
    const activeShipUiNames = new Set<string>();
    const barBackgroundPadding = {
      left: -1,
      right: 1,
      top: -2,
      bottom: 2,
    };

    // Calculate viewport bounds for glare updates
    const camera = pixi.camera;
    const cameraScale = camera.scale.x || 1;
    const shadowCameraScale = Math.max(cameraScale, 1);
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

    const ensureShipUiContainer = (entityId: number) => {
      const name = `ship-ui-${entityId}`;
      let uiContainer = pixi.camera.getChildByName(name) as Container | null;
      if (!uiContainer) {
        uiContainer = new Container();
        uiContainer.name = name;
        pixi.camera.addChild(uiContainer);
      }
      activeShipUiNames.add(name);
      return uiContainer;
    };

    const removeChildByName = (parent: Container, childName: string) => {
      const child = parent.getChildByName(childName);
      if (!child) return;
      parent.removeChild(child);
      child.destroy();
    };

    const ensureGraphicsChild = (parent: Container, childName: string) => {
      let gfx = parent.getChildByName(childName) as Graphics | null;
      if (!gfx) {
        gfx = new Graphics();
        gfx.name = childName;
        parent.addChild(gfx);
      }
      return gfx;
    };

    const ensureTextChild = (parent: Container, childName: string) => {
      let text = parent.getChildByName(childName) as Text | null;
      if (!text) {
        text = new Text({
          text: "",
          style: {
            fill: 0xffffff,
            fontSize: 6,
            fontFamily: "Press Start 2P, monospace",
          },
        });
        text.name = childName;
        text.anchor.set(0.5, 1);
        text.resolution = 2;
        parent.addChild(text);
      }
      return text;
    };

    const updateShipBars = (
      entityId: number,
      transform: { x: number; y: number },
      shipState: {
        health?: number;
        maxHealth?: number;
        energy?: number;
        maxEnergy?: number;
        radius?: number;
        id: string;
        name: string;
      },
      isPlayer: boolean
    ) => {
      const uiContainer = ensureShipUiContainer(entityId);
      uiContainer.x = transform.x;
      uiContainer.y = transform.y;
      uiContainer.rotation = 0;

      const shipRadius = shipState.radius ?? 13;
      const barWidth = Math.max(40, shipRadius * 2);
      const barHeight = 3;
      const healthYOffset = -(shipRadius + 16);
      const energyYOffset = healthYOffset + barHeight + 2;

      // Add name label above health bar for enemy ships
      if (!isPlayer) {
        const nameLabel = ensureTextChild(uiContainer, "name-label");
        nameLabel.text = shipState.name || "Unknown";
        nameLabel.y = healthYOffset - 3; // 3px above health bar
        nameLabel.x = 0;
        nameLabel.style.fontSize = 6;
      } else {
        removeChildByName(uiContainer, "name-label");
      }

      const getBackgroundRect = (baseY: number) => ({
        x: -barWidth / 2 - barBackgroundPadding.left,
        y: baseY - barBackgroundPadding.top,
        width:
          barWidth +
          barBackgroundPadding.left +
          barBackgroundPadding.right,
        height:
          barHeight +
          barBackgroundPadding.top +
          barBackgroundPadding.bottom,
      });

      const health = shipState.health ?? shipState.maxHealth ?? 1;
      const maxHealth = shipState.maxHealth ?? Math.max(health, 1);
      const hpRatio = clamp01(health / maxHealth);

      const hpBg = ensureGraphicsChild(uiContainer, "hp-bg");
      hpBg.clear();
      const hpBgRect = getBackgroundRect(healthYOffset);
      hpBg
        .rect(hpBgRect.x, hpBgRect.y, hpBgRect.width, hpBgRect.height)
        .fill({
          color: 0x222222,
          alpha: 0.85,
        });

      const hpColor = isPlayer
        ? hpRatio < 0.25
          ? 0xff0000
          : hpRatio < 0.5
            ? 0xffff00
            : 0x00ff00
        : 0xff0000;

      const hpFill = ensureGraphicsChild(uiContainer, "hp-fill");
      hpFill.clear();
      hpFill
        .rect(
          -barWidth / 2,
          healthYOffset,
          Math.max(barWidth * hpRatio, 0),
          barHeight
        )
        .fill({ color: hpColor });

      if (isPlayer) {
        const energy = shipState.energy ?? shipState.maxEnergy ?? 1;
        const maxEnergy = shipState.maxEnergy ?? Math.max(energy, 1);
        const energyRatio = clamp01(energy / maxEnergy);
        const energyBg = ensureGraphicsChild(uiContainer, "energy-bg");
        energyBg.clear();
        const energyBgRect = getBackgroundRect(energyYOffset);
        energyBg
          .rect(
            energyBgRect.x,
            energyBgRect.y,
            energyBgRect.width,
            energyBgRect.height
          )
          .fill({
            color: 0x222222,
            alpha: 0.85,
          });

        const energyColor =
          energyRatio < 0.3
            ? 0xff0000
            : energyRatio < 0.7
              ? 0xffff00
              : 0x00ffff;

        const energyFill = ensureGraphicsChild(uiContainer, "energy-fill");
        energyFill.clear();
        energyFill
          .rect(
            -barWidth / 2,
            energyYOffset,
            Math.max(barWidth * energyRatio, 0),
            barHeight
          )
          .fill({ color: energyColor });
      } else {
        removeChildByName(uiContainer, "energy-bg");
        removeChildByName(uiContainer, "energy-fill");
      }
    };

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
      // Keep any sprite-attached shadows aligned with the latest transform.
      syncShadowsInContainer(container, { cameraScale: shadowCameraScale });

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

      const shipState =
        networkState?.state?.type === "ship" ? networkState.state : null;
      if (shipState) {
        const isPlayerShip = services.player.entityId === entity;
        updateShipBars(entity, transform, shipState, isPlayerShip);
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

    for (const child of [...pixi.camera.children]) {
      if (!(child instanceof Container)) continue;
      const name = child.name;
      if (!name || !name.startsWith("ship-ui-")) continue;
      if (activeShipUiNames.has(name)) continue;
      pixi.camera.removeChild(child);
      child.destroy({ children: true });
    }
  },
};
