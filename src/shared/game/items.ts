export type ItemKind = "repair";

/** Gameplay tuning. Restart the server after editing. Speeds are world units/second. */
export const ITEM_CONFIG = {
  mediumAsteroidChance: 0.05,
  repairFraction: 0.25,
  pirateRepairFraction: 0.25,
  pirateSeekHealthBelow: 0.5,
  pirateSearchRadius: 500,
  radarRadius: 1900,
  launchSpeed: 225,
  driftSpeed: 12,
  // Remaining excess speed after one second (about 95% is lost in 0.65s).
  damping: 0.01,
  lifeSeconds: 60,
  radius: 10,
  restitution: 0.7,
  bulletImpulse: 100,
} as const;
