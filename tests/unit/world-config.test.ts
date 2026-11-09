import { expect, test } from "bun:test";
import { WORLD_CONFIG, resolveWorldConfig } from "../../src/server/engine/world/world-config";

test("default densities preserve the original world populations", () => {
  expect(resolveWorldConfig(WORLD_CONFIG)).toEqual({
    borderRadius: 50_000,
    targetAsteroids: 500_000,
    targetPirates: 50,
  });
});

test("population scales with area and rounds fractional counts to the nearest integer", () => {
  expect(resolveWorldConfig({ ...WORLD_CONFIG, size: 50_000 })).toEqual({
    borderRadius: 25_000,
    targetAsteroids: 125_000,
    targetPirates: 13,
  });
  expect(resolveWorldConfig({ ...WORLD_CONFIG, size: 200_000 })).toEqual({
    borderRadius: 100_000,
    targetAsteroids: 2_000_000,
    targetPirates: 200,
  });
  expect(resolveWorldConfig({ ...WORLD_CONFIG, size: 1000 }).targetPirates).toBe(0);
});

test("invalid sizes, densities and unrepresentable populations fail before generation", () => {
  for (const size of [0, -1000, 1500, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => resolveWorldConfig({ ...WORLD_CONFIG, size })).toThrow("World size");
  }
  for (const key of ["asteroidsPerMillionUnits", "piratesPerMillionUnits"] as const) {
    for (const density of [-1, NaN, Infinity]) {
      expect(() => resolveWorldConfig({ ...WORLD_CONFIG, [key]: density })).toThrow("density");
    }
    expect(() => resolveWorldConfig({ ...WORLD_CONFIG, [key]: Number.MAX_VALUE })).toThrow(
      "safe integer",
    );
  }
  expect(() => resolveWorldConfig({ ...WORLD_CONFIG, asteroidsPerMillionUnits: 500_000 })).toThrow(
    "Uint32",
  );
});
