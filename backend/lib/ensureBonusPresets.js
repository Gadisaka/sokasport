/**
 * Idempotent bonus preset rows (one per BonusType). Matches db seed semantics:
 * `upsert` with `update: {}` so existing rows are never overwritten.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 */
/**
 * Product default for CASHBACK (v3 two-profile rules). Shared by the seed
 * and the one-off `setCashbackProfiles` activation script.
 */
export const DEFAULT_CASHBACK_RULES = {
  maxHours: 48,
  excludeLiveForOnline: true,
  disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
  disqualifyMatchStatuses: ["SUSPENDED"],
  profiles: [
    {
      key: "oneLoss",
      lostLegs: 1,
      minLegs: 5,
      minLegOdds: 1.01,
      minStakeOnline: 10,
      minStakeOffline: 20,
      minResult: 19,
      tiers: [
        { minResult: 19, maxResult: 39, stakeMultiplier: 1 },
        { minResult: 40, maxResult: 59, stakeMultiplier: 2 },
        { minResult: 60, maxResult: 89, stakeMultiplier: 3 },
        { minResult: 90, maxResult: 250, stakeMultiplier: 5 },
        { minResult: 251, maxResult: 499, stakeMultiplier: 10 },
        { minResult: 500, maxResult: 999, stakeMultiplier: 20 },
        { minResult: 1000, maxResult: 1999, stakeMultiplier: 30 },
        { minResult: 2000, maxResult: 2999, stakeMultiplier: 50 },
        { minResult: 3000, maxResult: null, stakeMultiplier: 100 },
      ],
    },
    {
      key: "twoLoss",
      lostLegs: 2,
      minLegs: 10,
      minLegOdds: 1.4,
      minStakeOnline: 20,
      minStakeOffline: 20,
      minResult: 20,
      tiers: [
        { minResult: 20, maxResult: 45, stakeMultiplier: 1 },
        { minResult: 46, maxResult: 59, stakeMultiplier: 2 },
        { minResult: 61, maxResult: 89, stakeMultiplier: 3 },
        { minResult: 90, maxResult: 450, stakeMultiplier: 6 },
        { minResult: 451, maxResult: 999, stakeMultiplier: 12 },
        { minResult: 1000, maxResult: 1799, stakeMultiplier: 21 },
        { minResult: 1800, maxResult: null, stakeMultiplier: 50 },
      ],
    },
  ],
};

export const PRESET_BONUSES = [
  {
    type: "WELCOME",
    name: "Welcome bonus",
    percentage: 0,
    rules: {},
    status: false,
  },
  {
    type: "FIRST_DEPOSIT",
    name: "First deposit bonus",
    percentage: 0,
    min_deposit: 0,
    rules: {},
    status: false,
  },
  {
    type: "DEPOSIT",
    name: "Deposit bonus",
    percentage: 0,
    min_deposit: 0,
    rules: {},
    status: false,
  },
  {
    type: "ACCUMULATOR",
    name: "Accumulator bonus",
    percentage: 0,
    rules: { tiers: [] },
    status: false,
  },
  {
    type: "CASHBACK",
    name: "Cashback on losses",
    percentage: 0,
    // v3 two-profile: 1-loss and 2-loss tracks. Payout = stake x multiplier
    // from `result = sold total odds / sum of lost-leg odds`.
    rules: DEFAULT_CASHBACK_RULES,
    status: false,
  },
  {
    type: "REFERRAL",
    name: "Referral (reserved)",
    percentage: 0,
    rules: {},
    status: false,
  },
];

export const PRESET_BONUS_COUNT = PRESET_BONUSES.length;

export async function ensureBonusPresets(prisma) {
  for (const preset of PRESET_BONUSES) {
    await prisma.bonus.upsert({
      where: { type: preset.type },
      update: {},
      create: {
        name: preset.name,
        type: preset.type,
        percentage: preset.percentage,
        min_deposit: preset.min_deposit ?? null,
        rules: preset.rules ?? undefined,
        status: preset.status,
      },
    });
  }
}
