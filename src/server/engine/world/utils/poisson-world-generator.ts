import { Vector2 } from "@/shared/math/vector";

type GenerateWorldOpts = {
  seed?: number;
  safeSpawnRadius?: number;     // зона без астероидов в центре
  corridorWidth?: number;       // ширина коридоров
  corridors?: number;           // сколько коридоров через карту
  belts?: number;               // сколько поясов-колец
};

export function generateWorld(
  radius: number,
  asteroidsCount: number,
  opts: GenerateWorldOpts = {}
): Vector2[] {
  const seed = opts.seed ?? (Math.random() * 1e9) | 0;
  const rng = mulberry32(seed);

  const safeSpawnRadius = opts.safeSpawnRadius ?? radius * 0.08; // ~400 при r=5000
  const corridorWidth = opts.corridorWidth ?? radius * 0.035;    // ~175
  const corridors = opts.corridors ?? 2;
  const belts = opts.belts ?? 2;

  // 1) Базовый minDist под плотность
  const area = Math.PI * radius * radius;
  const avgSpacing = Math.sqrt(area / asteroidsCount);
  const minDistBase = avgSpacing * 0.65; // ~115 для 5000/2500

  // 2) Генерим "лишние" точки Poisson, чтобы было из чего отбирать
  const oversampleFactor = 1.6;
  const poissonPoints = poissonDiskInCircle(
    radius,
    minDistBase,
    Math.ceil(asteroidsCount * oversampleFactor),
    rng
  );

  // 3) Строим поле плотности + пояса + радиальный градиент
  const beltParams = makeBelts(radius, belts, rng);

  const scored = poissonPoints
    .map((p) => {
      const d = densityField(p, radius, beltParams, rng);
      return { p, score: d };
    })
    // 4) Геймплейные фильтры
    .filter(({ p }) => {
      // safe-spawn
      if (p.x * p.x + p.y * p.y < safeSpawnRadius * safeSpawnRadius) return false;
      // коридоры
      if (inAnyCorridor(p, radius, corridorWidth, corridors, seed)) return false;
      return true;
    });

  // 5) Гарантируем count: берём топ по score
  scored.sort((a, b) => b.score - a.score);
  let result = scored.slice(0, asteroidsCount).map((s) => s.p);

  // 6) Если вдруг недобрали (бывает при агрессивных вырезах) — добиваем
  if (result.length < asteroidsCount) {
    const need = asteroidsCount - result.length;
    const filler = fillRandomWithRejection(
      radius,
      need,
      minDistBase * 0.9,
      safeSpawnRadius,
      corridorWidth,
      corridors,
      beltParams,
      seed,
      rng,
      result
    );
    result = result.concat(filler);
  }

  return result;
}

/* ===================== helpers ===================== */

function poissonDiskInCircle(
  radius: number,
  minDist: number,
  targetCount: number,
  rng: () => number,
  k = 30
): Vector2[] {
  const cellSize = minDist / Math.SQRT2;
  const gridRad = Math.ceil((radius * 2) / cellSize);
  const gridSize = gridRad * gridRad;
  const grid = new Array<number>(gridSize).fill(-1);

  const points: Vector2[] = [];
  const active: Vector2[] = [];

  const toGrid = (p: Vector2) => {
    const gx = Math.floor((p.x + radius) / cellSize);
    const gy = Math.floor((p.y + radius) / cellSize);
    return { gx, gy };
  };
  const gridIndex = (gx: number, gy: number) => gy * gridRad + gx;

  function isInsideCircle(p: Vector2) {
    return p.x * p.x + p.y * p.y <= radius * radius;
  }

  function isFarEnough(p: Vector2): boolean {
    const { gx, gy } = toGrid(p);
    for (let yy = gy - 2; yy <= gy + 2; yy++) {
      for (let xx = gx - 2; xx <= gx + 2; xx++) {
        if (xx < 0 || yy < 0 || xx >= gridRad || yy >= gridRad) continue;
        const idx = grid[gridIndex(xx, yy)] ?? -1;
        if (idx === -1) continue;
        const q = points[idx];
        if (!q) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (dx * dx + dy * dy < minDist * minDist) return false;
      }
    }
    return true;
  }

  // стартовая точка
  const p0 = randomPointInCircle(radius, rng);
  points.push(p0);
  active.push(p0);
  {
    const { gx, gy } = toGrid(p0);
    grid[gridIndex(gx, gy)] = 0;
  }

  while (active.length && points.length < targetCount) {
    const i = (rng() * active.length) | 0;
    const p = active[i]!;
    let placed = false;

    for (let n = 0; n < k; n++) {
      const a = rng() * Math.PI * 2;
      const r = minDist * (1 + rng()); // [minDist, 2*minDist]
      const np = new Vector2(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      if (!isInsideCircle(np)) continue;
      if (!isFarEnough(np)) continue;

      points.push(np);
      active.push(np);
      const { gx, gy } = toGrid(np);
      grid[gridIndex(gx, gy)] = points.length - 1;
      placed = true;
      break;
    }

    if (!placed) active.splice(i, 1);
  }

  return points;
}

function densityField(
  p: Vector2,
  radius: number,
  belts: { r0: number; thickness: number; strength: number }[],
  rng: () => number
): number {
  const nx = p.x / radius;
  const ny = p.y / radius;

  // fbm шум 0..1
  const n = fbm(nx * 2.2, ny * 2.2, 5);

  // слабый градиент к центру (центр чуть плотнее)
  const dist = Math.sqrt(nx * nx + ny * ny); // 0..1
  const radial = 1.0 - dist; // больше у центра

  // пояса
  let beltBoost = 0;
  const r = Math.sqrt(p.x * p.x + p.y * p.y);
  for (const b of belts) {
    const t = Math.abs(r - b.r0) / b.thickness; // 0 у центра кольца
    if (t < 1) beltBoost += (1 - t) * b.strength;
  }

  // микс: базовая плотность + шум + радиал + пояса
  let d = 0.35 + 0.55 * n + 0.25 * radial + beltBoost;

  // подрезаем и чуть "контрастим"
  d = clamp01(d);
  d = smoothstep(0.15, 0.95, d);

  // маленькая рандомизация, чтобы не было стерильно
  d *= 0.9 + rng() * 0.2;

  return d;
}

function makeBelts(radius: number, count: number, rng: () => number) {
  const belts: { r0: number; thickness: number; strength: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r0 = radius * (0.35 + rng() * 0.5);      // 0.35R..0.85R
    const thickness = radius * (0.05 + rng() * 0.06); // 0.05R..0.11R
    const strength = 0.12 + rng() * 0.18;         // слабое усиление
    belts.push({ r0, thickness, strength });
  }
  return belts;
}

// Коридоры: N полос через карту с разными углами
function inAnyCorridor(
  p: Vector2,
  radius: number,
  width: number,
  corridors: number,
  seed: number
) {
  // углы фиксируем от seed, чтобы было детерминировано
  const rng = mulberry32(seed ^ 0x9e3779b9);

  for (let i = 0; i < corridors; i++) {
    const angle = rng() * Math.PI * 2;
    // расстояние точки до прямой через центр под углом angle
    // линия проходит через (0,0), нормаль = (cos, sin)
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const distToLine = Math.abs(p.x * nx + p.y * ny);
    if (distToLine < width) return true;
  }
  return false;
}

function fillRandomWithRejection(
  radius: number,
  need: number,
  minDist: number,
  safeSpawnRadius: number,
  corridorWidth: number,
  corridors: number,
  belts: { r0: number; thickness: number; strength: number }[],
  seed: number,
  rng: () => number,
  existing: Vector2[]
): Vector2[] {
  const out: Vector2[] = [];
  const all = existing.slice();

  const minDist2 = minDist * minDist;
  const safe2 = safeSpawnRadius * safeSpawnRadius;

  let attempts = 0;
  const maxAttempts = need * 200;

  while (out.length < need && attempts < maxAttempts) {
    attempts++;
    const p = randomPointInCircle(radius, rng);

    if (p.x * p.x + p.y * p.y < safe2) continue;
    if (inAnyCorridor(p, radius, corridorWidth, corridors, seed)) continue;

    const d = densityField(p, radius, belts, rng);
    if (rng() > d) continue;

    // проверка minDist к уже выбранным
    let ok = true;
    for (let i = 0; i < all.length; i++) {
      const q = all[i]!;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy < minDist2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    out.push(p);
    all.push(p);
  }

  return out;
}

/* ---------- math/noise/rng ---------- */

function randomPointInCircle(radius: number, rng: () => number): Vector2 {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;
  return new Vector2(Math.cos(a) * r, Math.sin(a) * r);
}

function fbm(x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm; // 0..1
}

function valueNoise2D(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const v00 = hash2(xi, yi);
  const v10 = hash2(xi + 1, yi);
  const v01 = hash2(xi, yi + 1);
  const v11 = hash2(xi + 1, yi + 1);

  const u = fade(xf);
  const v = fade(yf);

  const x1 = lerp(v00, v10, u);
  const x2 = lerp(v01, v11, u);
  return lerp(x1, x2, v);
}

function hash2(x: number, y: number): number {
  // детерминированный хэш -> 0..1
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 0xffffffff;
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}
function smoothstep(a: number, b: number, t: number) {
  t = clamp01((t - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
