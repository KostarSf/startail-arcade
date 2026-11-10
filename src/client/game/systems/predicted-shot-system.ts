import type { System } from "@/shared/ecs";
import type { ClientServices } from "../types";
import { ensureEntity, ensureRenderable } from "./interpolation-system";

export const PredictedShotSystem: System<ClientServices> = {
  id: "predicted-shot-system",
  stage: "prediction",
  priority: 2,
  tick({ services, entities, dt }) {
    const { predictedShots, stores, entityIndex } = services;
    const now = services.network.predictedServerTime();
    predictedShots.tick(now, dt);
    for (const shot of predictedShots.shots.values()) {
      if (shot.removed) {
        if (shot.entityId !== undefined) {
          entityIndex.delete(shot.indexId);
          const ref = stores.renderable.get(shot.entityId)?.ref;
          ref?.removeFromParent();
          ref?.destroy({ children: true });
          for (const store of Object.values(stores)) store.delete(shot.entityId);
          entities.destroy(shot.entityId);
        }
        predictedShots.shots.delete(shot.shotId);
        continue;
      }
      shot.entityId ??= entities.create();
      if (shot.indexId !== shot.state.id) entityIndex.delete(shot.indexId);
      shot.indexId = shot.state.id;
      entityIndex.set(shot.indexId, shot.entityId);
      ensureEntity(services, {
        entityId: shot.entityId,
        snapshot: { state: shot.state, serverTime: shot.anchorTime },
      });
      ensureRenderable(services, shot.entityId, shot.state);
      stores.transform.set(
        shot.entityId,
        predictedShots.position(shot, now, services.world.radius),
      );
      stores.velocity.set(shot.entityId, { vx: shot.state.vx, vy: shot.state.vy, va: 0 });
      const network = stores.networkState.get(shot.entityId)!;
      network.state = shot.state;
      network.lastServerTime = shot.anchorTime;
      network.predictedServerTime = now;
      network.renderDelay = 0;
      const presentation = stores.presentationState.get(shot.entityId)!;
      presentation.visualOffsetX = shot.offsetX;
      presentation.visualOffsetY = shot.offsetY;
    }
  },
};
