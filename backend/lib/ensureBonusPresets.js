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
    rules: { minTotalOdds: 1.5, percentOfStake: 0 },
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
