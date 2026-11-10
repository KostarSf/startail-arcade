import { ITEM_CONFIG } from "@/shared/game/items";
import { Random } from "@/shared/math/random";
import { worldDensity } from "./utils/fbm-domain-warp-world-generator";

// id, x, y, angle, vx, vy, va, radius, health, maxHealth, earnablePoints, itemKind (0=none, 1=repair).
export const ASTEROID_RECORD_WIDTH = 12;
export type ChunkManifest = { counts: Uint32Array; offsets: Uint32Array };

/** Exact logical population; small metadata only, no entity generation at startup. */
export function createChunkManifest(
  radius: number,
  size: number,
  count: number,
  seed: number,
): ChunkManifest {
  const axis = Math.ceil((radius * 2) / size),
    total = axis * axis;
  const weights = new Float64Array(total);
  let sum = 0;
  for (let i = 0; i < total; i++) {
    weights[i] = Math.max(
      0.01,
      worldDensity(
        ((i % axis) + 0.5) * size - radius,
        (Math.floor(i / axis) + 0.5) * size - radius,
        radius,
        seed,
      ),
    );
    sum += weights[i]!;
  }
  const counts = new Uint32Array(total),
    offsets = new Uint32Array(total + 1);
  let cumulative = 0;
  for (let i = 0; i < total; i++) {
    cumulative += weights[i]!;
    const end = i === total - 1 ? count : Math.floor((cumulative / sum) * count);
    counts[i] = end - offsets[i]!;
    offsets[i + 1] = end;
  }
  return { counts, offsets };
}

/** Each yield is one small candidate evaluation, allowing a time-budgeted scheduler. */
export function* generateChunk(
  radius: number,
  size: number,
  seed: number,
  index: number,
  manifest: ChunkManifest,
  itemChance: number = ITEM_CONFIG.mediumAsteroidChance,
): Generator<void, Float64Array> {
  const axis = Math.ceil((radius * 2) / size);
  const itemRandom = new Random((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
  const random = new Random((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const count = manifest.counts[index]!;
  const data = new Float64Array(count * ASTEROID_RECORD_WIDTH);
  const left = (index % axis) * size - radius,
    top = Math.floor(index / axis) * size - radius;
  for (let i = 0; i < count; i++) {
    let x = left,
      y = top;
    for (let attempt = 0; attempt < 64; attempt++) {
      x = left + random.next() * size;
      y = top + random.next() * size;
      const accepted = random.next() < worldDensity(x, y, radius, seed);
      yield;
      if (accepted) break;
    }
    const kind = random.integer(0, 2),
      r = [8, 12, 18][kind]!,
      health = [20, 50, 100][kind]!;
    const multiplier = [4, 1, 0.4][kind]!;
    data.set(
      [
        manifest.offsets[index]! + i,
        x,
        y,
        random.angle(),
        (random.next() * 50 - 25) * multiplier + random.next() * 10 - 3,
        (random.next() * 50 - 25) * multiplier + random.next() * 20 - 6,
        random.next() * Math.PI * 0.5 - Math.PI * 0.25,
        r,
        health,
        health,
        Math.floor(r * 1.25 * (0.8 + random.next() * 0.5)),
        kind === 1 && itemRandom.next() < itemChance ? 1 : 0,
      ],
      i * ASTEROID_RECORD_WIDTH,
    );
    yield;
  }
  return data;
}
