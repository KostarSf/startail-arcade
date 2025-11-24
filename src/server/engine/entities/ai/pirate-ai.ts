import { angleDiff, inverseLerp } from "@/shared/math/utils";
import { TPS } from "../../constants";
import type { World } from "../../world/world";
import { Exp } from "../exp";
import { LivingEntity } from "../living-entity";
import { Ship } from "../ship";
import { ShipAI } from "./ship-ai";

export class PirateAI extends ShipAI {
  #memorizedTarget: LivingEntity | null = null;
  #currentTarget: LivingEntity | null = null;

  #nearestObstacles = new Set<LivingEntity>();

  #avadingObstaclesRange = 40;
  #pursuitRange = 800;
  #alertRange = 500;
  #closeRange = 200;

  #earnablePoints = 45;

  #targetAngle = 0;

  constructor() {
    const tickRate = Math.floor(TPS / 4); // 4x slower than the game
    super(tickRate);
  }

  override initialize(ship: Ship, world: World) {
    this.#targetAngle = ship.angle;
    ship.earnablePoints = this.#earnablePoints;
  }

  override update(ship: Ship, world: World, delta: number) {
    super.update(ship, world, delta);

    ship.markChanged();

    this.#updateShipRotation(ship, world, delta);
    this.#avadeObstacles(ship, world, delta);
  }

  #updateShipRotation(ship: Ship, world: World, delta: number) {
    if (this.#targetAngle === ship.angle) return;

    const difference = angleDiff(ship.angle, this.#targetAngle);
    if (Math.abs(difference) > 0.01) {
      ship.angle += difference * delta * 10;
    } else {
      ship.angle = this.#targetAngle;
    }
  }

  #avadeObstacles(ship: Ship, world: World, delta: number) {
    for (const obstacle of this.#nearestObstacles) {
      if (!obstacle.isAlive) continue;

      const direction = obstacle.position.sub(ship.position);
      const distance =
        inverseLerp(
          ship.position.distance(obstacle.position),
          0,
          this.#avadingObstaclesRange
        ) *
          0.7 +
        0.3;

      ship.velocity = ship.velocity.sub(direction.mul(distance * delta * 4));
    }
  }

  override tick(ship: Ship, world: World, delta: number) {
    this.#updateTargets(ship, world, delta);

    if (this.#currentTarget) {
      this.#chase(ship, world, delta);
    } else {
      this.#idle(ship, world, delta);
    }
  }

  #updateTargets(ship: Ship, world: World, delta: number) {
    if (this.#memorizedTarget && !this.#memorizedTarget.isAlive) {
      this.#memorizedTarget = null;
    }

    if (this.#currentTarget) {
      const outOfRange =
        this.#currentTarget.position.distance(ship.position) >
        this.#pursuitRange;

      if (!this.#currentTarget.isAlive || (outOfRange && Math.random() < 0.2)) {
        this.#currentTarget = this.#memorizedTarget;
        this.#memorizedTarget = null;
      }
    }

    for (const obstacle of this.#nearestObstacles) {
      if (
        !obstacle.isAlive ||
        ship.position.distance(obstacle.position) > this.#avadingObstaclesRange
      ) {
        this.#nearestObstacles.delete(obstacle);
      }
    }

    const nearbyEntities = world.query(ship.position, this.#alertRange).array();

    for (const entity of nearbyEntities) {
      if (entity === ship) continue;

      if (
        entity instanceof LivingEntity &&
        !(entity instanceof Exp) &&
        entity.isAlive &&
        ship.position.distance(entity.position) < this.#avadingObstaclesRange
      ) {
        this.#nearestObstacles.add(entity);
        continue;
      }

      if (
        !this.#currentTarget &&
        entity instanceof Ship &&
        entity.player &&
        entity.isAlive
      ) {
        this.#updateTarget(entity);
        continue;
      }
    }
  }

  #idle(ship: Ship, world: World, delta: number) {
    const speed = ship.velocity.length();
    if (speed > 50) {
      this.#targetAngle = ship.velocity.angle() + Math.PI;
      ship.thrust = true;
    } else {
      ship.thrust = false;
    }
  }

  #chase(ship: Ship, world: World, delta: number) {
    const target = this.#currentTarget;
    if (!target) return;

    const distance = ship.position.distance(target.position);

    if (target instanceof Ship) {
      const inCloseRange = distance < this.#closeRange;
      ship.thrust = !inCloseRange;

      const fireChange = inCloseRange ? 0.05 : 0.1;
      const fire = Math.random() < fireChange;
      if (fire) {
        ship.fire(true);
      }
    }

    if (distance > 100) {
      this.#targetAngle = target.position
        .add(target.velocity.sub(ship.velocity))
        .sub(ship.position)
        .angle();
    } else {
      this.#targetAngle = target.position.sub(ship.position).angle();
    }
  }

  #updateTarget(target: LivingEntity) {
    if (!this.#currentTarget) {
      this.#currentTarget = target;
      return;
    }

    if (Math.random() < 0.1) {
      this.#memorizedTarget = this.#currentTarget;
      this.#currentTarget = target;
      return;
    }
  }
}
