import { view } from "@/shared/ecs";
import type { System } from "@/shared/ecs";
import { Graphics, Text } from "pixi.js";

import type { ClientServices } from "../types";

/**
 * Synchronizes PIXI display objects with ECS transforms each frame.
 * Also draws optional debug collider circles using server-provided radius.
 */
export const RenderSystem: System<ClientServices> = {
  id: "render-system",
  stage: "presentation",
  tick({ services }) {
    const { stores, debug, pixi } = services;
    const drawColliders = debug.drawColliders;
    const activeLabelNames = new Set<string>();

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

      // Debug collider rendering (if we have network state with radius)
      const networkState = stores.networkState.get(entity);
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
