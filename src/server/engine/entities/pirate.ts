import { normalizeAngle, TWO_PI } from "@/shared/game/entities/base";
import { angleLerp, inverseLerp } from "@/shared/math/utils";
import { Vector2 } from "@/shared/math/vector";
import { TPS } from "../constants";
import type { World } from "../world/world";
import type { BaseEntity } from "./base-entity";
import type { LivingEntity } from "./living-entity";
import { Ship } from "./ship";

export class Pirate extends Ship {
  override earnablePoints = 45;

  override name = "";

  #aiTickRate = Math.floor((Math.random() * 0.4 + 0.8) * (TPS / 1.8));

  #spotRange = 400;
  #lostRange = 600;
  #currentTarget: LivingEntity | null = null;

  #previousAngle = 0;
  #targetAngle = 0;

  override update(world: World, delta: number): void {
    super.update(world, delta);

    const ticksSinceLastUpdate = world.engine.tick % this.#aiTickRate;

    if (ticksSinceLastUpdate === 0) {
      this.#aiTick(world);
    }

    if (this.#previousAngle !== this.#targetAngle) {
      const tickProgress = inverseLerp(
        ticksSinceLastUpdate,
        0,
        this.#aiTickRate - 1
      );
      this.angle = normalizeAngle(
        angleLerp(this.#previousAngle, this.#targetAngle, tickProgress)
      );
    }
  }

  #aiTick(world: World): void {
    const distance = this.#currentTarget
      ? this.position.sub(this.#currentTarget.position).length()
      : Infinity;

    if (!this.#currentTarget) {
      const nearbyEntities = world
        .query(this.position, this.#spotRange)
        .array();
      for (const entity of nearbyEntities) {
        if (entity instanceof Ship && entity.isAlive && entity.player) {
          console.log("pirate found target", entity.name);
          this.#currentTarget = entity;
          break;
        }
      }
    } else {
      if (distance > this.#lostRange) {
        console.log("pirate lost target", this.#currentTarget?.name);
        this.#currentTarget = null;
        this.thrust = false;
        this.#previousAngle = this.angle;
        this.#targetAngle = this.angle;
      }
    }

    if (this.#currentTarget) {
      const direction = this.#currentTarget.position
        .sub(this.position)
        .normalize();

      const rawTargetAngle = Math.atan2(direction.y, direction.x);

      this.#previousAngle = this.angle;
      this.#targetAngle = rawTargetAngle;

      this.thrust = distance > 100;
    }
  }

  protected override onDeath(world: World, source?: BaseEntity): void {
    super.onDeath(world, source);
    console.log("pirate died", this.id);
  }
}
