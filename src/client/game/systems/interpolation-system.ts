import {
  AnimatedSprite,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from "pixi.js";

import type { EntityId, System } from "@/shared/ecs";
import {
  normalizeAngle,
  type GenericNetEntityState,
} from "@/shared/game/entities/base";
import type { SnapshotStreamHealth } from "@/shared/network/events";
import { lerp } from "@/shared/math/utils";

import type { WorldState } from "../network/snapshot-buffer";
import type { ClientServices } from "../types";
import { addShadowToContainer } from "../utils/shadow-utils";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface TimedEntity {
  state: GenericNetEntityState;
  serverTime: number;
}

interface EntityPair {
  from?: TimedEntity;
  to?: TimedEntity;
}

const ensureRenderable = (
  services: ClientServices,
  entityId: EntityId,
  snapshotEntity: GenericNetEntityState
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
        texture =
          services.textures.asteroids.large[
            Math.floor(Math.random() * services.textures.asteroids.large.length)
          ]!;
      } else if (radius > 10) {
        texture =
          services.textures.asteroids.medium[
            Math.floor(
              Math.random() * services.textures.asteroids.medium.length
            )
          ]!;
      } else {
        texture =
          services.textures.asteroids.small[
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
    case "exp":
      {
        // Select sprite based on value
        const value = (snapshotEntity as any).value ?? 0;
        let expTexture: Texture;
        let scale = 1;
        if (value < 50) {
          expTexture = services.textures.exp1;
          scale = 1.5 + (value < 5 ? 0.2 : value < 10 ? 0.6 : 1);
        } else if (value < 500) {
          expTexture = services.textures.exp2;
          scale = 1.125 + (value < 50 ? 0.2 : value < 100 ? 0.6 : 1);
        } else {
          expTexture = services.textures.exp3;
          scale = 1.25 + (value < 500 ? 0.2 : value < 1000 ? 0.6 : 1);
        }

        const expSprite = new Sprite({
          texture: expTexture,
          anchor: 0.5,
        });
        expSprite.scale.set(scale);

        // Add glare sprite below exp so exp renders on top
        const glareSprite = new Sprite({
          texture: services.textures.glare,
          anchor: 0.5,
        });
        glareSprite.name = "glare";
        glareSprite.rotation = 0; // Keep horizontal
        container.addChild(glareSprite); // Add first so it renders below
        addShadowToContainer({ parent: container, base: expSprite });
        container.addChild(expSprite); // Add after glare and shadow so exp renders on top
        sprite = expSprite;
      }
      break;
    default: {
      const radius = snapshotEntity.radius ?? 10;
      const circle = new Graphics();
      circle.circle(0, 0, radius);
      circle.fill(0x00ff00); // Green color
      circle.stroke({ color: 0x00cc00, width: 1 });
      circle.name = "default-circle";

      const label = new Text({
        text: snapshotEntity.type ?? "unknown",
        style: {
          fontSize: 12,
          fill: 0xffffff,
          align: "center",
        },
      });
      label.anchor.set(0.5);
      label.y = radius + 5; // Position label below the circle

      container.addChild(circle);
      container.addChild(label);
      break;
    }
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
    lastSimTick: 0,
    predictedServerTime: services.network.predictedServerTime(),
    renderDelay: services.network.renderDelayMs,
    snapshots: [],
    lastAcknowledgedInput: snapshot.lastInputSequence ?? -1,
  }));

  stores.presentationState.ensure(entityId, () => ({
    wasUsingTail: false,
    visualOffsetX: 0,
    visualOffsetY: 0,
    visualOffsetAngle: 0,
  }));
};

const removeMissingEntities = (
  latestSnapshot: WorldState,
  services: ClientServices,
  entities: import("@/shared/ecs").EntityManager
) => {
  const liveIds = new Set(latestSnapshot.entities.keys());
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
    services.stores.presentationState.delete(entityId);
    entities.destroy(entityId);
  }
};

const angleLerp = (start: number, end: number, alpha: number) => {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return normalizeAngle(start + delta * alpha);
};

const getTailDurationMs = (
  entity: GenericNetEntityState,
  health: SnapshotStreamHealth,
  isPlayer: boolean
) => {
  if (isPlayer) {
    return 0;
  }

  switch (entity.type) {
    case "ship":
      return health === "degraded" ? 40 : health === "stressed" ? 60 : 90;
    case "asteroid":
      return health === "degraded" ? 60 : health === "stressed" ? 90 : 130;
    case "bullet":
      return health === "normal" ? 16 : 0;
    case "exp":
      return health === "normal" ? 12 : 0;
    default:
      return 0;
  }
};

const getCorrectionDurationMs = (
  entity: GenericNetEntityState,
  health: SnapshotStreamHealth
) => {
  switch (entity.type) {
    case "asteroid":
      return health === "degraded" ? 70 : health === "stressed" ? 90 : 120;
    case "ship":
      return health === "degraded" ? 60 : health === "stressed" ? 80 : 110;
    case "bullet":
    case "exp":
      return 55;
    default:
      return 80;
  }
};

const shouldSnapCorrection = (
  entity: GenericNetEntityState,
  distance: number,
  worldRadius: number
) => {
  if (distance > worldRadius) {
    return true;
  }

  switch (entity.type) {
    case "bullet":
      return distance > 25;
    case "exp":
      return distance > 18;
    case "ship":
      return distance > 150;
    case "asteroid":
      return distance > 180;
    default:
      return distance > 120;
  }
};

/**
 * Buffers server snapshots, keeps the ECS in sync with streamed entities,
 * and interpolates transforms at predicted server time minus the render delay.
 */
export const InterpolationSystem: System<ClientServices> = {
  id: "interpolation-system",
  stage: "prediction",
  tick({ services, entities, dt }) {
    const disableInterpolation = services.debug.disableInterpolation;
    const latestSnapshot = services.snapshotBuffer.getLatest();
    const predictedServerTime = services.network.predictedServerTime();
    const targetTime = disableInterpolation
      ? latestSnapshot?.serverTime ?? 0
      : predictedServerTime - services.network.renderDelayMs;
    const { previous, next } = disableInterpolation
      ? { previous: latestSnapshot, next: latestSnapshot }
      : services.snapshotBuffer.getWindow(targetTime);

    services.network.updatePresentationWindow({
      predictedServerTime,
      latestSnapshotServerTime: latestSnapshot?.serverTime ?? null,
      hasNextSnapshot: next !== null,
      dtMs: dt * 1000,
    });

    if (!previous && !next) return;

    const fromSnapshot = previous ?? next!;
    const toSnapshot = next ?? previous!;
    services.world.renderedSimTick = previous?.simTick ?? toSnapshot.simTick;
    const fromTime = fromSnapshot.serverTime;
    const toTime = toSnapshot.serverTime;
    const total = Math.max(toTime - fromTime, 1);
    const alpha = clamp01((targetTime - fromTime) / total);

    const pairMap = new Map<string, EntityPair>();
    const indexSnapshot = (snapshot: WorldState | null, key: "from" | "to") => {
      if (!snapshot) return;
      for (const entity of snapshot.entities.values()) {
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
      const usingTail =
        !disableInterpolation &&
        pair.from !== undefined &&
        pair.to === undefined &&
        targetTime > source.serverTime;

      const entityId = services.entityIndex.get(serverId) ?? entities.create();
      services.entityIndex.set(serverId, entityId);

      ensureEntity(services, {
        entityId,
        snapshot: target,
      });
      ensureRenderable(services, entityId, target.state);

      const transform = services.stores.transform.get(entityId);
      const presentationState = services.stores.presentationState.get(entityId);
      if (transform) {
        const previousX = transform.x;
        const previousY = transform.y;
        const previousAngle = transform.angle;
        const dx = target.state.x - source.state.x;
        const dy = target.state.y - source.state.y;
        const distance = Math.hypot(dx, dy);
        const teleported = distance > services.world.radius;
        if (teleported) {
          lerpAlpha = 1;
        }

        let authoritativeX = lerp(source.state.x, target.state.x, lerpAlpha);
        let authoritativeY = lerp(source.state.y, target.state.y, lerpAlpha);
        let authoritativeAngle = angleLerp(
          source.state.angle,
          target.state.angle,
          lerpAlpha
        );

        const tailDurationMs = getTailDurationMs(
          target.state,
          services.network.streamHealth,
          isPlayer
        );

        if (
          presentationState &&
          usingTail &&
          !teleported &&
          tailDurationMs > 0
        ) {
          const extrapolationMs = clamp(
            targetTime - source.serverTime,
            0,
            tailDurationMs
          );
          const extrapolationSeconds = extrapolationMs / 1000;
          authoritativeX =
            source.state.x + (source.state.vx ?? 0) * extrapolationSeconds;
          authoritativeY =
            source.state.y + (source.state.vy ?? 0) * extrapolationSeconds;
          authoritativeAngle = normalizeAngle(
            source.state.angle + (source.state.va ?? 0) * extrapolationSeconds
          );
          presentationState.wasUsingTail = true;
          presentationState.visualOffsetX = 0;
          presentationState.visualOffsetY = 0;
          presentationState.visualOffsetAngle = 0;
        } else if (presentationState) {
          if (presentationState.wasUsingTail) {
            const correctionDistance = Math.hypot(
              previousX - authoritativeX,
              previousY - authoritativeY
            );
            if (
              shouldSnapCorrection(
                target.state,
                correctionDistance,
                services.world.radius
              )
            ) {
              presentationState.visualOffsetX = 0;
              presentationState.visualOffsetY = 0;
              presentationState.visualOffsetAngle = 0;
            } else {
              presentationState.visualOffsetX = previousX - authoritativeX;
              presentationState.visualOffsetY = previousY - authoritativeY;
              presentationState.visualOffsetAngle = normalizeAngle(
                previousAngle - authoritativeAngle
              );
            }
          }

          presentationState.wasUsingTail = false;

          const correctionDurationMs = getCorrectionDurationMs(
            target.state,
            services.network.streamHealth
          );
          const correctionAlpha = clamp01((dt * 1000) / correctionDurationMs);
          presentationState.visualOffsetX = lerp(
            presentationState.visualOffsetX,
            0,
            correctionAlpha
          );
          presentationState.visualOffsetY = lerp(
            presentationState.visualOffsetY,
            0,
            correctionAlpha
          );
          presentationState.visualOffsetAngle = angleLerp(
            presentationState.visualOffsetAngle,
            0,
            correctionAlpha
          );

          authoritativeX += presentationState.visualOffsetX;
          authoritativeY += presentationState.visualOffsetY;
          authoritativeAngle = normalizeAngle(
            authoritativeAngle + presentationState.visualOffsetAngle
          );
        }

        transform.x = authoritativeX;
        transform.y = authoritativeY;
        transform.angle = authoritativeAngle;
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
        networkState.lastSimTick = toSnapshot.simTick;
        networkState.predictedServerTime = predictedServerTime;
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
