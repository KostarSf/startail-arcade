import { view } from "@/shared/ecs";
import type { System } from "@/shared/ecs";

import type { ClientServices } from "../types";

export const RenderSystem: System<ClientServices> = {
  id: "render-system",
  stage: "presentation",
  tick({ services }) {
    const { stores } = services;
    for (const [, transform, renderable] of view(
      stores.transform,
      stores.renderable
    )) {
      if (!renderable.ref) continue;
      renderable.ref.x = transform.x;
      renderable.ref.y = transform.y;
      renderable.ref.rotation = transform.angle;
    }
  },
};
