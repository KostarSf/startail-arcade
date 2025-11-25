import { angleDiff, angleLerp, inverseLerp } from "@/shared/math/utils";
import { Vector2 } from "@/shared/math/vector";
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

  #avadingObstaclesRange = 60;
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

    // First, blend obstacle avoidance with the target angle
    this.#avadeObstacles(ship, world, delta);

    // Then apply the final blended angle to the ship
    this.#updateShipRotation(ship, world, delta);
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

  /**
   * Predicts the ship's position after a given time based on current velocity.
   */
  #predictShipPosition(ship: Ship, lookAheadTime: number): Vector2 {
    return ship.position.add(ship.velocity.mul(lookAheadTime));
  }

  /**
   * Gets the dynamic avoidance range based on ship speed.
   * At higher speeds, the ship needs to detect obstacles earlier.
   * Becomes more aggressive above speed 100.
   */
  #getDynamicAvoidanceRange(ship: Ship): number {
    const speed = ship.velocity.length();

    if (speed < 100) {
      // Below 100 speed: scale from 60 to 100
      const speedFactor = inverseLerp(speed, 0, 100);
      return this.#avadingObstaclesRange + speedFactor * 40;
    } else {
      // Above 100 speed: scale more aggressively from 100 to 180
      const speedFactor = inverseLerp(speed, 100, 250);
      return 100 + speedFactor * 80;
    }
  }

  /**
   * Computes a safe escape angle by analyzing all nearby obstacles.
   * Returns null if no obstacles need avoiding.
   */
  #computeEscapeAngle(ship: Ship): { angle: number; urgency: number } | null {
    if (this.#nearestObstacles.size === 0) return null;

    const speed = ship.velocity.length();
    const dynamicRange = this.#getDynamicAvoidanceRange(ship);

    // Predict ship position further ahead at high speeds (1.5-3 seconds)
    const lookAheadTime = speed < 100
      ? 1.5 + (speed / 200) // 1.5-2 seconds below 100 speed
      : 2.0 + (speed / 250); // 2-3 seconds above 100 speed
    const predictedPosition = this.#predictShipPosition(ship, lookAheadTime);

    let totalWeight = 0;
    let weightedDirection = Vector2.ZERO;
    let maxUrgency = 0;

    for (const obstacle of this.#nearestObstacles) {
      if (!obstacle.isAlive) continue;

      const distance = ship.position.distance(obstacle.position);
      if (distance > dynamicRange) continue;

      // Direction away from obstacle
      const awayDirection = ship.position.sub(obstacle.position).normalize();

      // Base weight: closer obstacles have more influence
      let weight = 1 - inverseLerp(distance, 0, dynamicRange);

      // Check if obstacle is in predicted path
      const predictedDistance = predictedPosition.distance(obstacle.position);
      const obstacleRadius = obstacle.radius ?? 20;
      const threatDistance = obstacleRadius + 30; // Safety margin

      if (predictedDistance < threatDistance) {
        // Obstacle is directly in our path - increase weight significantly
        weight *= 4; // Increased from 3 to 4 for more aggressive avoidance
      } else if (predictedDistance < distance) {
        // We're getting closer to obstacle - increase weight
        weight *= 2.5; // Increased from 2 to 2.5
      }

      // Speed influence: at high speed, obstacles matter MUCH more
      // Start scaling from speed 50, and be very aggressive above 100
      let speedMultiplier;
      if (speed < 100) {
        speedMultiplier = 1 + inverseLerp(speed, 50, 100) * 1.5;
      } else {
        // Above 100: scale from 2.5x to 5x
        speedMultiplier = 2.5 + inverseLerp(speed, 100, 250) * 2.5;
      }
      weight *= speedMultiplier;

      weightedDirection = weightedDirection.add(awayDirection.mul(weight));
      totalWeight += weight;

      // Track maximum urgency for blending
      const urgency = Math.min(weight / speedMultiplier, 4);
      maxUrgency = Math.max(maxUrgency, urgency);
    }

    if (totalWeight === 0) return null;

    // Calculate the weighted average direction
    const escapeDirection = weightedDirection.div(totalWeight);
    const escapeAngle = escapeDirection.angle();

    // Normalize urgency to 0-1 range, with higher urgency at high speeds
    const normalizedUrgency = Math.min(maxUrgency / 4, 1);

    return { angle: escapeAngle, urgency: normalizedUrgency };
  }

  /**
   * Handles obstacle avoidance by blending escape angle with target angle.
   * This method modifies this.#targetAngle to avoid obstacles while trying to
   * maintain the original goal (chasing or idling).
   */
  #avadeObstacles(ship: Ship, world: World, delta: number) {
    const escapeResult = this.#computeEscapeAngle(ship);

    if (!escapeResult) {
      // No obstacles to avoid
      return;
    }

    const { angle: escapeAngle, urgency } = escapeResult;
    const speed = ship.velocity.length();

    // Blend the escape angle with the current target angle
    // Higher urgency means more influence from escape angle
    // At high speeds (>60), allow up to 100% override for aggressive avoidance
    let maxBlend = 0.8; // Default: 80% max
    if (speed > 60) {
      // Above 100 speed: scale from 80% to 100%
      maxBlend = 0.8 + inverseLerp(speed, 100, 200) * 0.2;
    }

    const blendFactor = urgency * maxBlend;
    this.#targetAngle = angleLerp(this.#targetAngle, escapeAngle, blendFactor);

    // Enable thrust when avoiding obstacles to maneuver effectively
    // At high speeds, always thrust when avoiding
    if (speed > 100 || urgency > 0.3) {
      ship.thrust = true;
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

    // Use dynamic range for obstacle detection
    const dynamicRange = this.#getDynamicAvoidanceRange(ship);

    for (const obstacle of this.#nearestObstacles) {
      if (
        !obstacle.isAlive ||
        ship.position.distance(obstacle.position) > dynamicRange
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
        ship.position.distance(entity.position) < dynamicRange
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
    if (speed > 100) {
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

      const fireChange = inCloseRange ? 0.1 : 0.15;
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
