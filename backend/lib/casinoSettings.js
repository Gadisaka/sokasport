/**
 * Casino master switch.
 *
 * A single platform setting that turns the entire player-facing casino
 * (`/casino`) on or off, independently of InOut. When disabled, the lobby
 * shows a blank screen and no games/launches are served.
 *
 * @module lib/casinoSettings
 */

export const CASINO_ENABLED_SETTING_KEY = "CASINO_ENABLED";

/** Default when no row exists yet: casino is on. */
export const DEFAULT_CASINO_ENABLED = true;

/**
 * Resolve the current on/off state.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @returns {Promise<boolean>}
 */
export async function resolveCasinoEnabled(prisma) {
  const row = await prisma.setting.findUnique({
    where: { key: CASINO_ENABLED_SETTING_KEY },
  });
  if (!row) return DEFAULT_CASINO_ENABLED;
  return row.value === "true" || row.value === "1";
}
