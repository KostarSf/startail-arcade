import { AnimatedSprite, Container, Rectangle, Sprite, Texture, TextureSource } from "pixi.js";

import type { EntityId, System } from "@/shared/ecs";
import { normalizeAngle } from "@/shared/game/entities/base";
import { lerp } from "@/shared/math/utils";

import type { ServerSnapshot } from "../network/snapshot-buffer";
import type { ClientServices } from "../types";
import { addShadowToContainer } from "../utils/shadow-utils";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type SnapshotEntity = ServerSnapshot["entities"][number];

interface TimedEntity {
  state: SnapshotEntity;
  serverTime: number;
}

interface EntityPair {
  from?: TimedEntity;
  to?: TimedEntity;
}

const ensureRenderable = (
  services: ClientServices,
  entityId: EntityId,
  snapshotEntity: SnapshotEntity
) => {
  const existing = services.stores.renderable.get(entityId);
  if (existing?.ref) return existing;

  const container = new Container();
  let sprite: Sprite | AnimatedSprite | null = null;
  switch (snapshotEntity.type) {
    case "ship":
      sprite = new Sprite({
        texture:
          snapshotEntity.id === services.player.id
            ? services.textures.player
            : services.textures.pirate,
        anchor: 0.5,
      });
      if (snapshotEntity.id !== services.player.id) {
        sprite.tint = 0xa0a0a0;
      }
      break;
    case "asteroid":
      const radius = snapshotEntity.radius ?? 0;

      let texture: Texture<TextureSource<any>>;

      if (radius > 15) {
        texture = services.textures.asteroids.large[
          Math.floor(Math.random() * services.textures.asteroids.large.length)
        ]!;
      } else if (radius > 10) {
        texture = services.textures.asteroids.medium[
          Math.floor(Math.random() * services.textures.asteroids.medium.length)
        ]!;
      } else {
        texture = services.textures.asteroids.small[
          Math.floor(Math.random() * services.textures.asteroids.small.length)
        ]!;
      }

      sprite = new Sprite({
        texture: texture,
        anchor: 0.5,
      });
      sprite.tint = 0xa0a0a0;
      break;
    case "bullet":
      {
        // Create animated sprite from 16x6 spritesheet (2 frames of 8x6 each)
        const bulletTexture = services.textures.bullet;
        const frame1 = new Texture({
          source: bulletTexture.source,
          frame: new Rectangle(0, 0, 8, 6),
        });
        const frame2 = new Texture({
          source: bulletTexture.source,
          frame: new Rectangle(8, 0, 8, 6),
        });
        const bulletSprite = new AnimatedSprite([frame1, frame2]);
        bulletSprite.anchor.set(0.5);
        // Animation speed: 2 frames per 500ms = 4 fps
        // animationSpeed is frames per second, so 4 fps = 4.0
        bulletSprite.animationSpeed = 4.0;
        bulletSprite.play();

        // Add glare sprite below bullet so bullet renders on top
        const glareSprite = new Sprite({
          texture: services.textures.glare,
          anchor: 0.5,
        });
        glareSprite.name = "glare";
        glareSprite.rotation = 0; // Keep horizontal
        container.addChild(glareSprite); // Add first so it renders below
        addShadowToContainer({ parent: container, base: bulletSprite });
        container.addChild(bulletSprite); // Add after glare and shadow so bullet renders on top
      }
      break;
  }

  if (sprite) {
    addShadowToContainer({ parent: container, base: sprite });
    container.addChild(sprite);
  }
  services.pixi.camera.addChild(container);
  const renderable = {
    ref: container,
    depth: snapshotEntity.type === "ship" ? 1 : 0,
  };
  services.stores.renderable.set(entityId, renderable);

  if (snapshotEntity.id === services.player.id) {
    services.stats().setPlayerObject(container);
  }

  return renderable;
};

const ensureEntity = (
  services: ClientServices,
  context: { entityId: EntityId; snapshot: TimedEntity }
) => {
  const {
    entityId,
    snapshot: { state: snapshot, serverTime },
  } = context;
  const { stores } = services;

  stores.transform.ensure(entityId, () => ({
    x: snapshot.x,
    y: snapshot.y,
    angle: snapshot.angle,
  }));

  stores.velocity.ensure(entityId, () => ({
    vx: snapshot.vx,
    vy: snapshot.vy,
    va: snapshot.va ?? 0,
  }));

  if (snapshot.type === "ship") {
    stores.shipControl.ensure(entityId, () => ({
      thrust: snapshot.thrust ?? false,
      angle: snapshot.angle,
      fire: false,
      lastServerSequence: snapshot.lastInputSequence ?? -1,
      pendingInputs: [],
    }));
  }

  stores.networkState.ensure(entityId, () => ({
    lastServerTime: serverTime,
    predictedServerTime: services.network.predictedServerTime(),
    renderDelay: services.network.renderDelayMs,
    snapshots: [],
    lastAcknowledgedInput: snapshot.lastInputSequence ?? -1,
  }));
};

const removeMissingEntities = (
  latestSnapshot: ServerSnapshot,
  services: ClientServices,
  entities: import("@/shared/ecs").EntityManager
) => {
  const liveIds = new Set(latestSnapshot.entities.map((entity) => entity.id));
  for (const [serverId, entityId] of services.entityIndex.entries()) {
    if (liveIds.has(serverId)) continue;

    // Capture death position BEFORE deleting stores (if this is the player)
    if (services.player.entityId === entityId) {
      const transform = services.stores.transform.get(entityId);
      if (transform && services.player.id) {
        services.stats().setDeathPosition({ x: transform.x, y: transform.y });
      }
      services.player.entityId = null;
      services.stats().setPlayerObject(null);
    }

    services.entityIndex.delete(serverId);
    const renderable = services.stores.renderable.get(entityId);
    if (renderable?.ref) {
      services.pixi.camera.removeChild(renderable.ref);
      renderable.ref.destroy();
    }
    services.stores.renderable.delete(entityId);
    services.stores.transform.delete(entityId);
    services.stores.velocity.delete(entityId);
    services.stores.shipControl.delete(entityId);
    services.stores.networkState.delete(entityId);
    entities.destroy(entityId);
  }
};

const angleLerp = (start: number, end: number, alpha: number) => {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return normalizeAngle(start + delta * alpha);
};

/**
 * Buffers server snapshots, keeps the ECS in sync with streamed entities,
 * and interpolates transforms at predicted server time minus the render delay.
 */
export const InterpolationSystem: System<ClientServices> = {
  id: "interpolation-system",
  stage: "prediction",
  tick({ services, entities }) {
    const targetTime =
      services.network.predictedServerTime() - services.network.renderDelayMs;
    const { previous, next } = services.snapshotBuffer.getWindow(targetTime);
    if (!previous && !next) return;

    const fromSnapshot = previous ?? next!;
    const toSnapshot = next ?? previous!;
    const fromTime = fromSnapshot.serverTime;
    const toTime = toSnapshot.serverTime;
    const total = Math.max(toTime - fromTime, 1);
    const alpha = clamp01((targetTime - fromTime) / total);

    const pairMap = new Map<string, EntityPair>();
    const indexSnapshot = (
      snapshot: ServerSnapshot | null,
      key: "from" | "to"
    ) => {
      if (!snapshot) return;
      for (const entity of snapshot.entities) {
        const existing = pairMap.get(entity.id) ?? {};
        existing[key] = { state: entity, serverTime: snapshot.serverTime };
        pairMap.set(entity.id, existing);
      }
    };

    indexSnapshot(previous, "from");
    indexSnapshot(next, "to");

    for (const [serverId, pair] of pairMap.entries()) {
      const source = pair.from ?? pair.to!;
      const target = pair.to ?? pair.from!;
      let lerpAlpha = pair.from && pair.to ? alpha : pair.to ? 1 : 0;
      const isPlayer = serverId === services.player.id;

      const entityId = services.entityIndex.get(serverId) ?? entities.create();
      services.entityIndex.set(serverId, entityId);

      ensureEntity(services, {
        entityId,
        snapshot: target,
      });
      ensureRenderable(services, entityId, target.state);

      const transform = services.stores.transform.get(entityId);
      if (transform) {
        const dx = target.state.x - source.state.x;
        const dy = target.state.y - source.state.y;
        const distance = Math.hypot(dx, dy);
        const teleported = distance > services.world.radius;
        if (teleported) {
          lerpAlpha = 1;
        }

        transform.x = lerp(source.state.x, target.state.x, lerpAlpha);
        transform.y = lerp(source.state.y, target.state.y, lerpAlpha);
        transform.angle = angleLerp(
          source.state.angle,
          target.state.angle,
          lerpAlpha
        );
      }

      const velocity = services.stores.velocity.get(entityId);
      if (velocity) {
        velocity.vx = lerp(source.state.vx, target.state.vx, lerpAlpha);
        velocity.vy = lerp(source.state.vy, target.state.vy, lerpAlpha);
        velocity.va = lerp(
          source.state.va ?? 0,
          target.state.va ?? 0,
          lerpAlpha
        );
      }

      const networkState = services.stores.networkState.get(entityId);
      if (networkState) {
        networkState.lastServerTime = target.serverTime;
        networkState.predictedServerTime =
          services.network.predictedServerTime();
        networkState.renderDelay = services.network.renderDelayMs;
        networkState.lastAcknowledgedInput =
          target.state.lastInputSequence ?? networkState.lastAcknowledgedInput;
        networkState.state = {
          ...target.state,
          va: target.state.va ?? 0,
        };
      }

      if (target.state.type === "ship") {
        const shipControl = services.stores.shipControl.get(entityId);
        if (shipControl) {
          if (!isPlayer) {
            shipControl.angle = target.state.angle;
            shipControl.thrust = target.state.thrust ?? shipControl.thrust;
          }
          if (
            target.state.lastInputSequence !== undefined &&
            target.state.lastInputSequence > shipControl.lastServerSequence
          ) {
            shipControl.lastServerSequence = target.state.lastInputSequence;
          }
        }
        if (isPlayer) {
          if (services.player.entityId === null) {
            services.controls.angle = target.state.angle;
          }
          services.player.entityId = entityId;
        }
      }
    }

    removeMissingEntities(next ?? fromSnapshot, services, entities);
    services.stats().setObjectsCount(services.entityIndex.size);
  },
};
