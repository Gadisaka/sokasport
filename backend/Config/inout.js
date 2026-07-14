/**
 * InOut Games integration config.
 *
 * Values are read from the environment (see `.env.staging` / `.env` on the
 * server). Secrets (`INOUT_SIGNATURE_KEY`) must never be committed.
 *
 * The signature key is required to verify inbound webhook signatures; the
 * operator id + launch base url are required to build launch URLs. We read
 * lazily (via getters) so importing this module never throws at boot — the
 * webhook/launch layers validate presence when they actually need a value.
 *
 * @module Config/inout
 */

export const INOUT_DEFAULT_CURRENCY =
  process.env.INOUT_DEFAULT_CURRENCY || "ETB";

/**
 * Default ISO country code sent on launch URLs. InOut requires `userCountryCode`
 * for both real and demo launches; we default to Ethiopia and allow per-request
 * overrides.
 */
export const INOUT_DEFAULT_COUNTRY =
  (process.env.INOUT_DEFAULT_COUNTRY || "ET").toUpperCase();

export const INOUT_LAUNCH_BASE_URL =
  process.env.INOUT_LAUNCH_BASE_URL || "https://api.inout.games/api/launch";

/** Base URL for InOut REST endpoints (e.g. gameModesList). */
export const INOUT_API_BASE_URL =
  process.env.INOUT_API_BASE_URL || "https://api.inout.games/api";

/**
 * Fixed demo operator id published in InOut's frontend docs. Demo/spectator
 * launches use this operator with `currency=DEMO`; our own operator id is
 * passed as `themeId` for branded loading screens.
 */
export const INOUT_DEMO_OPERATOR_ID =
  process.env.INOUT_DEMO_OPERATOR_ID || "ee2013ed-e1f0-4d6e-97d2-f36619e2eb52";

export const INOUT_ALIAS = process.env.INOUT_ALIAS || "sokasport-prod";

/** @returns {string} Operator ID (UUID) issued by InOut. */
export function getInoutOperatorId() {
  const v = process.env.INOUT_OPERATOR_ID;
  if (!v) {
    throw new Error("INOUT_OPERATOR_ID is not set");
  }
  return v;
}

/** @returns {string} HMAC-SHA256 signature key issued by InOut. */
export function getInoutSignatureKey() {
  const v = process.env.INOUT_SIGNATURE_KEY;
  if (!v) {
    throw new Error("INOUT_SIGNATURE_KEY is not set");
  }
  return v;
}

/**
 * True when the minimal config needed to verify webhooks is present.
 * Used by the webhook middleware to fail closed with a clear message.
 */
export function isInoutWebhookConfigured() {
  return Boolean(process.env.INOUT_SIGNATURE_KEY);
}

/**
 * True when the config needed to build launch URLs is present.
 */
export function isInoutLaunchConfigured() {
  return Boolean(process.env.INOUT_OPERATOR_ID);
}
