export function makeAryphmeticCurve(
  targetXp = 25,
  multiplier = 1
) {
  // Closed-form formula derived from geometric series:
  // xpTotalForLevel(L) = targetXp * multiplier * (multiplier^(L-1) - 1) / (multiplier - 1)
  // For multiplier = 1, it's a simple arithmetic progression: targetXp * (L - 1)
  const xpTotalForLevel = (L: number) => {
    if (L <= 1) return 0;
    if (multiplier === 1) {
      return Math.floor(targetXp * (L - 1));
    }
    return Math.floor(
      (targetXp * multiplier * (Math.pow(multiplier, L - 1) - 1)) /
        (multiplier - 1)
    );
  };

  const levelFromXp = (xp: number) => {
    if (xp < 0) return 1;

    if (multiplier < 1) {
      throw new Error("Multiplier must be greater than or equal to 1");
    }

    if (multiplier === 1) {
      return Math.floor(xp / targetXp) + 1;
    }

    // Solve: xp >= targetXp * multiplier * (multiplier^(L-1) - 1) / (multiplier - 1)
    // Rearranged: L <= 1 + log_multiplier(1 + xp * (multiplier - 1) / (targetXp * multiplier))
    const logArg = 1 + (xp * (multiplier - 1)) / (targetXp * multiplier);
    const level = Math.floor(1 + Math.log(logArg) / Math.log(multiplier));

    // Ensure we don't go below level 1
    return Math.max(1, level);
  };

  const xpDeltaForLevel = (L: number) => {
    if (L < 2) return 0;
    const prev = xpTotalForLevel(L - 1);
    const curr = xpTotalForLevel(L);
    return curr - prev;
  };

  return { xpTotalForLevel, levelFromXp, xpDeltaForLevel };
}
