import { Graphics } from "pixi.js";
import type { System } from "@/shared/ecs";

import type { ClientServices } from "../types";

const BIG_CELL_SIZE = 1000;
const SMALL_CELL_SIZE = 500;

/**
 * Renders a dev grid overlay showing world coordinates.
 * Big cells: 1000 units, Small cells: 500 units.
 */
export const GridSystem: System<ClientServices> = {
  id: "grid-system",
  stage: "presentation",
  priority: 3, // Run after camera system (priority 2)
  init({ services }) {
    // Check if grid already exists
    if ((services as any).grid) return;
    const grid = new Graphics();
    grid.zIndex = -1000; // Render behind everything
    grid.visible = true;
    services.pixi.camera.addChild(grid);
    services.pixi.camera.sortableChildren = true; // Enable zIndex sorting
    (services as any).grid = grid;
  },
  tick({ services }) {
    const {
      pixi: { app, camera, renderWidth, renderHeight },
      debug,
    } = services;
    const grid = (services as any).grid as Graphics;
    if (!grid) {
      console.warn("[GridSystem] Grid not found!");
      return;
    }

    // Check if grid should be drawn
    // Access the getter explicitly to ensure we get the current value
    const shouldDrawGrid = debug.drawGrid;
    if (!shouldDrawGrid) {
      grid.clear();
      grid.visible = false;
      return;
    }

    grid.visible = true;

    // Get camera scale (default to 1 if not set, ensure it's positive)
    const scale = Math.max(camera.scale.x || 1, 0.1);

    // Calculate visible world bounds using the same formula as input system
    // World coordinates: worldX = (screenX - camera.x) / scale
    // Screen center world position (using render dimensions):
    const screenCenterX = renderWidth / 2;
    const screenCenterY = renderHeight / 2;

    // If camera hasn't moved (x/y are 0 or very close), center on origin
    let cameraWorldX: number;
    let cameraWorldY: number;
    if (Math.abs(camera.x) < 0.01 && Math.abs(camera.y) < 0.01) {
      // Camera at origin, draw grid centered on screen
      cameraWorldX = screenCenterX / scale;
      cameraWorldY = screenCenterY / scale;
    } else {
      cameraWorldX = (screenCenterX - camera.x) / scale;
      cameraWorldY = (screenCenterY - camera.y) / scale;
    }

    const viewWidth = renderWidth / scale;
    const viewHeight = renderHeight / scale;

    // Extend bounds to ensure grid covers visible area plus margin
    const left = cameraWorldX - viewWidth / 2 - BIG_CELL_SIZE;
    const right = cameraWorldX + viewWidth / 2 + BIG_CELL_SIZE;
    const top = cameraWorldY - viewHeight / 2 - BIG_CELL_SIZE;
    const bottom = cameraWorldY + viewHeight / 2 + BIG_CELL_SIZE;

    grid.clear();

    // Calculate grid bounds based on visible area
    const smallStartX = Math.floor(left / SMALL_CELL_SIZE) * SMALL_CELL_SIZE;
    const smallStartY = Math.floor(top / SMALL_CELL_SIZE) * SMALL_CELL_SIZE;
    const smallEndX = Math.ceil(right / SMALL_CELL_SIZE) * SMALL_CELL_SIZE;
    const smallEndY = Math.ceil(bottom / SMALL_CELL_SIZE) * SMALL_CELL_SIZE;

    // Draw small grid (500 units) - gray lines
    grid.setStrokeStyle({ width: 2, color: 0x888888, alpha: 0.7 });

    // Draw vertical lines every 500 units
    for (let x = smallStartX; x <= smallEndX; x += SMALL_CELL_SIZE) {
      grid.moveTo(x, top);
      grid.lineTo(x, bottom);
    }

    // Draw horizontal lines every 500 units
    for (let y = smallStartY; y <= smallEndY; y += SMALL_CELL_SIZE) {
      grid.moveTo(left, y);
      grid.lineTo(right, y);
    }

    grid.stroke();

    // Draw big grid (1000 units) - brighter gray lines, thicker
    const bigStartX = Math.floor(left / BIG_CELL_SIZE) * BIG_CELL_SIZE;
    const bigStartY = Math.floor(top / BIG_CELL_SIZE) * BIG_CELL_SIZE;
    const bigEndX = Math.ceil(right / BIG_CELL_SIZE) * BIG_CELL_SIZE;
    const bigEndY = Math.ceil(bottom / BIG_CELL_SIZE) * BIG_CELL_SIZE;

    grid.setStrokeStyle({ width: 3, color: 0xaaaaaa, alpha: 0.9 });
    for (let x = bigStartX; x <= bigEndX; x += BIG_CELL_SIZE) {
      grid.moveTo(x, top);
      grid.lineTo(x, bottom);
    }
    for (let y = bigStartY; y <= bigEndY; y += BIG_CELL_SIZE) {
      grid.moveTo(left, y);
      grid.lineTo(right, y);
    }

    grid.stroke();

    // Draw origin axes - green lines, thickest
    grid.setStrokeStyle({ width: 4, color: 0x00ff00, alpha: 1.0 });
    if (left <= 0 && right >= 0) {
      grid.moveTo(0, top);
      grid.lineTo(0, bottom);
    }
    if (top <= 0 && bottom >= 0) {
      grid.moveTo(left, 0);
      grid.lineTo(right, 0);
    }
    grid.stroke();

    // Draw world border (-2000 to 2000) - red lines (only if enabled)
    if (debug.drawWorldBorder) {
      const WORLD_MIN = -2000;
      const WORLD_MAX = 2000;

      // Only draw border if any part is visible in the viewport
      if (left <= WORLD_MAX && right >= WORLD_MIN && top <= WORLD_MAX && bottom >= WORLD_MIN) {
        grid.setStrokeStyle({ width: 5, color: 0xff0000, alpha: 1.0 });

        // Draw border rectangle (only visible portions)
        const borderLeft = Math.max(left, WORLD_MIN);
        const borderRight = Math.min(right, WORLD_MAX);
        const borderTop = Math.max(top, WORLD_MIN);
        const borderBottom = Math.min(bottom, WORLD_MAX);

        // Top edge
        grid.moveTo(borderLeft, WORLD_MIN);
        grid.lineTo(borderRight, WORLD_MIN);
        // Bottom edge
        grid.moveTo(borderLeft, WORLD_MAX);
        grid.lineTo(borderRight, WORLD_MAX);
        // Left edge
        grid.moveTo(WORLD_MIN, borderTop);
        grid.lineTo(WORLD_MIN, borderBottom);
        // Right edge
        grid.moveTo(WORLD_MAX, borderTop);
        grid.lineTo(WORLD_MAX, borderBottom);

        grid.stroke();
      }
    }
  },
};
