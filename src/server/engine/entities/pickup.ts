import { ITEM_CONFIG, type ItemKind } from "@/shared/game/items";
import { Vector2 } from "@/shared/math/vector";
import type { World } from "../world/world";
import { Asteroid } from "./asteroid";
import { BaseEntity, type IBaseEntity } from "./base-entity";
import { Ship } from "./ship";

/** Server-authoritative collectible; never participates in damage or experience. */
export class Pickup extends BaseEntity {
  override type = "pickup" as const;
  readonly itemKind: ItemKind;
  simulationPaused = true;

  setSimulationPaused(paused: boolean) {
    if (this.simulationPaused === paused) return;
    this.simulationPaused = paused;
    this.markChanged();
  }
  override radius = ITEM_CONFIG.radius;
  override linearDamping = ITEM_CONFIG.damping;
  override targetSpeed = ITEM_CONFIG.driftSpeed;

  constructor(data: Partial<IBaseEntity> & { itemKind?: ItemKind } = {}) {
    super({ ...data, continuousCollision: true, life: data.life ?? ITEM_CONFIG.lifeSeconds });
    this.itemKind = data.itemKind ?? "repair";
  }

  override canWakeChunks() {
    return true;
  }
  override getChunkWakeSources() {
    return [{ shape: "circle" as const, x: this.x, y: this.y, radius: 100 }];
  }

  push(direction: Vector2) {
    if (direction.length() < 1e-8) return;
    this.velocity = this.velocity.add(direction.normalize().mul(ITEM_CONFIG.bulletImpulse));
    const speed = this.velocity.length();
    if (speed > ITEM_CONFIG.launchSpeed)
      this.velocity = this.velocity.mul(ITEM_CONFIG.launchSpeed / speed);
    this.markChanged();
  }

  override onCollisionStart(world: World, other: BaseEntity) {
    if (this.removed || other.removed) return;
    if (other instanceof Ship) {
      if (!other.isAlive || other.health >= other.maxHealth) return;
      const fraction = other.ai ? ITEM_CONFIG.pirateRepairFraction : ITEM_CONFIG.repairFraction;
      other.heal(Math.min(other.maxHealth - other.health, other.maxHealth * fraction));
      this.remove(); // Atomic claim: a second ship cannot collect it in the same tick.
      world.emit({
        kind: "item-pickup",
        replication: "relevant",
        entityId: this.id,
        shipId: other.id,
        x: this.x,
        y: this.y,
      });
    } else if (other instanceof Asteroid) {
      const offset = world.displacement(other, this);
      const normal = offset.length() > 1e-8 ? offset.normalize() : new Vector2(1, 0);
      const relative = this.velocity.sub(other.velocity);
      const approaching = relative.dot(normal);
      if (approaching < 0)
        this.velocity = relative
          .sub(normal.mul((1 + ITEM_CONFIG.restitution) * approaching))
          .add(other.velocity);
      // Separate overlapping bodies, including contacts across the world seam.
      const distance = world.distance(other, this);
      const overlap = other.radius + this.radius - distance;
      if (overlap >= 0) this.position = this.position.add(normal.mul(overlap + 0.1));
      world.updateSpatialIndex(this);
      this.markChanged();
    }
  }

  override toJSON() {
    return { ...super.toJSON(), itemKind: this.itemKind, simulationPaused: this.simulationPaused };
  }
}
