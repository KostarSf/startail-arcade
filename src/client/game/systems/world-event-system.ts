import type { System } from "@/shared/ecs";

import type { ClientServices } from "../types";

export const WorldEventSystem: System<ClientServices> = {
  id: "world-event-system",
  stage: "network",
  priority: 0,
  tick({ services }) {
    const renderedSimTick = services.world.renderedSimTick;
    if (renderedSimTick <= 0) {
      return;
    }

    const events = services.eventBuffer.drainUpTo(renderedSimTick);
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      switch (event.kind) {
        case "entity-damage":
          {
            const entityId = services.entityIndex.get(event.entityId);
            const networkState =
              entityId !== undefined
                ? services.stores.networkState.get(entityId)
                : undefined;
            const soundId =
              networkState?.state?.type === "ship"
                ? "snd_hit"
                : "snd_small_hit";

            services.effects.queueDamageText({
              amount: event.amount,
              x: event.x,
              y: event.y,
            });

            if (event.amount >= 0) {
              services.audio.playOneShot({
                soundId,
                position: { x: event.x, y: event.y },
              });

              if (networkState?.state?.type === "ship") {
                services.effects.queueExplosion({
                  x: event.x,
                  y: event.y,
                });
              }
            }
          }
          break;
        case "entity-destroy":
          if (event.entityId === services.player.id) {
            services.audio.playOneShot({ soundId: "snd_death" });
          }
          services.audio.playOneShot({
            soundId: "snd_explode",
            position: { x: event.x, y: event.y },
          });
          services.effects.queueExplosion({
            x: event.x,
            y: event.y,
          });
          break;
        case "player-score":
          services.audio.playOneShot({
            soundId: "snd_fuel",
            pitch: 0.8 + Math.random() * 0.4,
          });
          services.stats().addFloatingScoreText(event.delta);
          break;
        case "player-level-up":
          services.audio.playOneShot({ soundId: "snd_pick_energy" });
          break;
      }
    }
  },
};
