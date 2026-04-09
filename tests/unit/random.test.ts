import { describe, expect, test } from "bun:test";

import { Random } from "../../src/shared/math/random";

describe("Random", () => {
  test("produces the same sequence for the same seed", () => {
    const left = new Random(42);
    const right = new Random(42);

    const leftSequence = Array.from({ length: 5 }, () => left.next());
    const rightSequence = Array.from({ length: 5 }, () => right.next());

    expect(leftSequence).toEqual(rightSequence);
  });

  test("pickSet without duplicates returns unique values", () => {
    const random = new Random(42);
    const picked = random.pickSet(["a", "b", "c", "d"], 3);

    expect(new Set(picked).size).toBe(3);
  });
});
