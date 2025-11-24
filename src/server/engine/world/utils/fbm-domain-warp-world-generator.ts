import { Vector2 } from "@/shared/math/vector";

type GenerateWorldNoiseOpts = {
  seed?: number;

  // --- уровни масштаба ---
  macroScale?: number;       // крупные биомы (в юнитах мира)
  midScale?: number;         // "уровень ~1000" для заметной смены плотности
  octavesMacro?: number;     // октавы для макро
  octavesMid?: number;       // октавы для мид

  warpStrength?: number;     // domain warp
  contrast?: number;         // контраст кластеров
  fill?: number;             // общий уровень заполнения

  edgeFalloff?: number;      // 0..1, если хочешь чуть реже у краев квадрата
};

export function generateWorld(
  radius: number,
  asteroidsCount: number,
  opts: GenerateWorldNoiseOpts = {}
): Vector2[] {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const rng = mulberry32(seed);

  const macroScale = opts.macroScale ?? radius * 0.42; // ~2100 при r=5000
  const midScale = opts.midScale ?? 1000;             // как ты просил
  const octMacro = opts.octavesMacro ?? 4;
  const octMid = opts.octavesMid ?? 3;

  const warpStrength = opts.warpStrength ?? 0.9;
  const contrast = opts.contrast ?? 2.1;
  const fill = opts.fill ?? 0.58;
  const edgeFalloff = opts.edgeFalloff ?? 0.08;

  const out: Vector2[] = [];
  let attempts = 0;
  const maxAttempts = asteroidsCount * 250;

  while (out.length < asteroidsCount && attempts < maxAttempts) {
    attempts++;

    const p = randomPointInSquare(radius, rng);

    const d = densityAtSquare(
      p.x,
      p.y,
      radius,
      macroScale,
      midScale,
      octMacro,
      octMid,
      warpStrength,
      edgeFalloff,
      seed
    );

    // усиливаем кластеры и подгоняем общий fill
    const prob = clamp01(Math.pow(d, contrast) * (fill / 0.58));

    if (rng() < prob) out.push(p);
  }

  // если поле оказалось слишком пустым — добиваем рандомом
  while (out.length < asteroidsCount) {
    out.push(randomPointInSquare(radius, rng));
  }

  return out;
}

/* ================= density field (square) ================= */

function densityAtSquare(
  x: number,
  y: number,
  radius: number,
  macroScale: number,
  midScale: number,
  octMacro: number,
  octMid: number,
  warpStrength: number,
  edgeFalloff: number,
  seed: number
): number {
  // координаты для макро/мид шума
  let mx = x / macroScale;
  let my = y / macroScale;
  let sx = x / midScale;
  let sy = y / midScale;

  // domain warp на макро уровне (чтобы пятна были "живее")
  const wx = fbm(mx * 1.6 + 11.3, my * 1.6 - 4.7, octMacro, seed ^ 0xA1B2C3);
  const wy = fbm(mx * 1.6 - 7.9, my * 1.6 + 19.1, octMacro, seed ^ 0xC3B2A1);
  mx += (wx - 0.5) * warpStrength * 2.0;
  my += (wy - 0.5) * warpStrength * 2.0;

  // 1) макро биомы 0..1
  let macro = fbm(mx, my, octMacro, seed);

  // 2) средний уровень (~1000 единиц) 0..1
  // тоже слегка варпнем, но слабее
  const swx = fbm(sx * 1.4 + 3.3, sy * 1.4 + 8.8, octMid, seed ^ 0x51ED);
  const swy = fbm(sx * 1.4 - 6.6, sy * 1.4 - 2.2, octMid, seed ^ 0xBEEF);
  sx += (swx - 0.5) * warpStrength * 0.8;
  sy += (swy - 0.5) * warpStrength * 0.8;

  let mid = fbm(sx, sy, octMid, seed ^ 0x1234);

  // приводим оба к более "биомному" виду
  macro = smoothstep(0.22, 0.92, macro);
  mid = smoothstep(0.18, 0.95, mid);

  // микс слоёв:
  // макро задаёт базу (где вообще плотные зоны),
  // mid добавляет ещё один "уровень" плотности поверх
  let d = 0.15 + 0.65 * macro + 0.35 * mid;

  d = clamp01(d);

  // лёгкое разрежение к краям квадрата (по Chebyshev distance)
  if (edgeFalloff > 0) {
    const edge = Math.max(Math.abs(x), Math.abs(y)) / radius; // 0..1
    const fall = 1.0 - edge;
    d = clamp01(d * (1.0 - edgeFalloff) + fall * edgeFalloff);
  }

  return d;
}

/* ================= noise/rng/utils ================= */

function randomPointInSquare(radius: number, rng: () => number): Vector2 {
  return new Vector2((rng() * 2 - 1) * radius, (rng() * 2 - 1) * radius);
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return sum / norm; // 0..1
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);

  const u = fade(xf);
  const v = fade(yf);

  const x1 = lerp(v00, v10, u);
  const x2 = lerp(v01, v11, u);
  return lerp(x1, x2, v);
}

function hash2(x: number, y: number, seed: number): number {
  let n = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return ((n >>> 0) / 0xffffffff);
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

function fade(t: number) { return t * t * (3 - 2 * t); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smoothstep(a: number, b: number, t: number) {
  t = clamp01((t - a) / (b - a));
  return t * t * (3 - 2 * t);
}
