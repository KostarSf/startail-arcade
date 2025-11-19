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
const FIRE_SHAKE_DURATION = 0.20; // Slightly longer duration (150ms)

/**
 * Captures local controls, mutates the player's ship component immediately,
 * and emits buffered commands to the network layer for reconciliation.
 */
export const InputSystem: System<ClientServices> = {
  id: "input-system",
  stage: "input",
  tick({ services }) {
    const { player, controls, stores, network, inputBuffer, pixi, cameraShake } = services;
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

    const shipControl = stores.shipControl.ensure(player.entityId, defaultControl);
    const transform = stores.transform.get(player.entityId);

    if (transform) {
      controls.angle = Math.atan2(
        cursorWorld.y - transform.y,
        cursorWorld.x - transform.x
      );
      transform.angle = controls.angle;
    }

    let dirty = false;

    if (Math.abs(shipControl.angle - controls.angle) > 0.001) {
      shipControl.angle = controls.angle;
      dirty = true;
    }
    if (shipControl.thrust !== controls.thrust) {
      shipControl.thrust = controls.thrust;
      dirty = true;
    }
    if (controls.fire) {
      shipControl.fire = true;
      dirty = true;

      // Trigger shake when player fires
      cameraShake.add(FIRE_SHAKE_AMPLITUDE, FIRE_SHAKE_DURATION);
    }

    if (!dirty) return;

    const command = network.sendInput({
      thrust: shipControl.thrust,
      angle: shipControl.angle,
      fire: shipControl.fire,
    });

    if (command) {
      inputBuffer.enqueue(command);
    }

    controls.fire = false;
    shipControl.fire = false;
  },
};
