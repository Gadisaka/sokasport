/**
 * Idempotent bonus preset rows (one per BonusType). Matches db seed semantics:
 * `upsert` with `update: {}` so existing rows are never overwritten.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 */
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
    // Tiered (v2): payout = stake x multiplier where the multiplier is
    // chosen by `result = total_odds / largest-lost-leg-odds`. Eligibility
    // gates: count > minSelections, stake >= minStake, settled within
    // maxHours of placement, and no leg on a disqualified fixture/match.
    rules: {
      minSelections: 2,
      minStake: 0,
      maxHours: 72,
      minResult: 20,
      disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
      disqualifyMatchStatuses: ["SUSPENDED"],
      tiers: [
        { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
        { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
        { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
        { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
        { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
        { minResult: 400, maxResult: null, stakeMultiplier: 10 },
      ],
    },
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
