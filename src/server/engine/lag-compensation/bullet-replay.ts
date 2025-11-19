import { integrateMotion } from "@/shared/game/entities/base";
import {
  createBulletSpawnFromShip,
  type ShipState,
} from "@/shared/game/entities/ship";

import { DT_MS } from "../constants";
import type { BaseEntity } from "../entities/base-entity";
import { Bullet } from "../entities/bullet";
import type { WorldSnapshot } from "../world/snapshot-buffer";

const BULLET_RADIUS = 2;
const SHIP_RADIUS = 12;

type SnapshotEntityState = WorldSnapshot["entities"][number] & {
  size?: number;
};

type BulletSimulationState = {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  va: number;
  life: number;
};

interface CollisionCandidate {
  id: string;
  type: string;
  x: number;
  y: number;
  radius: number;
}

export interface BulletReplayParams {
  shooterId: string;
  startSnapshot: WorldSnapshot;
  shipSnapshot: WorldSnapshot["entities"][number];
  snapshots: WorldSnapshot[];
  worldEntities: BaseEntity[];
  now: number;
  fireAngle?: number;
}

export function replayBulletFromSnapshots({
  shooterId,
  startSnapshot,
  shipSnapshot,
  snapshots,
  worldEntities,
  now,
  fireAngle,
}: BulletReplayParams) {
  const bulletState = createBulletState(shipSnapshot, fireAngle);
  if (!bulletState) return null;

  if (
    checkCollision(
      bulletState,
      buildSnapshotCandidates(startSnapshot.entities),
      shooterId
    )
  ) {
    return null;
  }

  let previousTime = startSnapshot.serverTime;

  for (const snapshot of snapshots) {
    const delta = snapshot.serverTime - previousTime;
    advanceBullet(bulletState, delta);
    if (bulletState.life <= 0) {
      return null;
    }
    if (
      checkCollision(
        bulletState,
        buildSnapshotCandidates(snapshot.entities),
        shooterId
      )
    ) {
      return null;
    }
    previousTime = snapshot.serverTime;
  }

  const deltaToNow = now - previousTime;
  advanceBullet(bulletState, deltaToNow);
  if (bulletState.life <= 0) {
    return null;
  }

  if (
    checkCollision(
      bulletState,
      buildLiveCandidates(worldEntities),
      shooterId
    )
  ) {
    return null;
  }

  return new Bullet({
    x: bulletState.x,
    y: bulletState.y,
    angle: bulletState.angle,
    vx: bulletState.vx,
    vy: bulletState.vy,
    life: Math.max(1, Math.ceil(bulletState.life)),
    ownerId: shooterId,
  });
}

function createBulletState(
  entity: WorldSnapshot["entities"][number],
  fireAngle?: number
): BulletSimulationState | null {
  if (entity.type !== "ship") return null;

  // If fireAngle is provided, we use it for the spawn calculation.
  // We need to override the angle in the ship state before calculating spawn.
  const shipState = { ...entity } as ShipState;
  if (typeof fireAngle === "number" && Number.isFinite(fireAngle)) {
    shipState.angle = fireAngle;
  }

  const spawn = createBulletSpawnFromShip(shipState);
  return {
    ...spawn,
    va: 0,
    life: Bullet.lifeSpan,
  };
}

function advanceBullet(state: BulletSimulationState, deltaMs: number) {
  if (deltaMs <= 0) return;
  integrateMotion(state, deltaMs / 1000);
  state.life -= deltaMs / DT_MS;
}

function buildSnapshotCandidates(
  entities: WorldSnapshot["entities"]
): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = [];
  for (const entity of entities) {
    const candidate = createCandidate(
      {
        id: entity.id,
        type: entity.type,
        x: entity.x,
        y: entity.y,
      },
      (entity as SnapshotEntityState).size
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function buildLiveCandidates(entities: BaseEntity[]): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = [];
  for (const entity of entities) {
    const candidate = createCandidate(
      {
        id: entity.id,
        type: entity.type,
        x: entity.x,
        y: entity.y,
      },
      (entity as { size?: number }).size
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function createCandidate(
  entity: { id: string; type: string; x: number; y: number },
  size?: number
): CollisionCandidate | null {
  const radius = getRadius(entity.type, size);
  if (!radius) return null;
  return {
    ...entity,
    radius,
  };
}

function getRadius(type: string, size?: number) {
  if (type === "ship") return SHIP_RADIUS;
  if (type === "asteroid") return size ?? 10;
  return null;
}

function checkCollision(
  bullet: BulletSimulationState,
  candidates: CollisionCandidate[],
  shooterId: string
) {
  for (const candidate of candidates) {
    if (candidate.id === shooterId) continue;
    const dx = candidate.x - bullet.x;
    const dy = candidate.y - bullet.y;
    const combinedRadius = BULLET_RADIUS + candidate.radius;
    if (dx * dx + dy * dy <= combinedRadius * combinedRadius) {
      return true;
    }
  }
  return false;
}
