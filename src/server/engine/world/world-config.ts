export const WORLD_CHUNK_SIZE = 1000;

export type WorldConfig = Readonly<{
  /** Side length of the square world; must be a positive multiple of 1000. */
  size: number;
  /** Average population per 1000 × 1000 world units, including unloaded chunks. */
  asteroidsPerMillionUnits: number;
  /** Average population per 1000 × 1000 world units, including dormant pirates. */
  piratesPerMillionUnits: number;
}>;

/** Applied when a World is constructed. Restart the server after editing. */
export const WORLD_CONFIG: WorldConfig = {
  size: 10_000,
  asteroidsPerMillionUnits: 50,
  piratesPerMillionUnits: 0.005,
};

export function resolveWorldConfig(config: WorldConfig) {
  if (
    !Number.isSafeInteger(config.size) ||
    config.size <= 0 ||
    config.size % WORLD_CHUNK_SIZE !== 0
  ) {
    throw new Error("World size must be a positive safe integer multiple of 1000");
  }
  const areaUnits = (config.size / 1000) ** 2;
  const population = (density: number, name: string) => {
    if (!Number.isFinite(density) || density < 0) {
      throw new Error(`${name} density must be finite and non-negative`);
    }
    const count = Math.round(areaUnits * density);
    if (!Number.isSafeInteger(count)) {
      throw new Error(`${name} population must be a safe integer`);
    }
    return count;
  };
  const targetAsteroids = population(config.asteroidsPerMillionUnits, "Asteroid");
  // Chunk manifests store cumulative asteroid offsets in Uint32Array.
  if (targetAsteroids > 0xffffffff) {
    throw new Error("Asteroid population exceeds the chunk manifest Uint32 limit");
  }
  return {
    borderRadius: config.size / 2,
    targetAsteroids,
    targetPirates: population(config.piratesPerMillionUnits, "Pirate"),
  };
}
