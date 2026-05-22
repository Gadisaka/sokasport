/**
 * Cash-out payout margin configured by admins.
 * Stored in `settings` and applied as:
 *   cashout = stake * currentWonOdds * margin
 */

export const CASHOUT_MARGIN_SETTING_KEY = "CASHOUT_SYSTEM_MARGIN";
export const DEFAULT_CASHOUT_MARGIN = 0.7;
export const MIN_CASHOUT_MARGIN = 0.1;
export const MAX_CASHOUT_MARGIN = 0.9;

/**
 * Resolve effective cash-out margin from admin settings.
 * Falls back to a sane default if missing/invalid.
 *
 * @param {import("@prisma/client").PrismaClient} prismaClient
 * @returns {Promise<number>}
 */
export async function resolveCashoutMargin(prismaClient) {
  const row = await prismaClient.setting.findUnique({
    where: { key: CASHOUT_MARGIN_SETTING_KEY },
  });

  if (!row?.value) return DEFAULT_CASHOUT_MARGIN;

  const parsed = Number.parseFloat(row.value);
  if (!Number.isFinite(parsed)) return DEFAULT_CASHOUT_MARGIN;
  if (parsed < MIN_CASHOUT_MARGIN || parsed > MAX_CASHOUT_MARGIN) {
    return DEFAULT_CASHOUT_MARGIN;
  }

  return parsed;
}
