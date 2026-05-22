/**
 * Winnings (income) tax — admin-configured, snapshotted per ticket at creation.
 * Stored in `settings` table as two keys.
 */
import { toMoney as decimalToMoney, d } from "./moneyDecimal.js";

export const WINNINGS_TAX_ENABLED_SETTING_KEY = "WINNINGS_TAX_ENABLED";
export const WINNINGS_TAX_RATE_SETTING_KEY = "WINNINGS_TAX_RATE";

/** When settings rows are missing, match previous hardcoded sportsbook behavior. */
export const DEFAULT_WINNINGS_TAX_ENABLED = true;
export const DEFAULT_WINNINGS_TAX_RATE = 0.15;
export const MIN_WINNINGS_TAX_RATE = 0;
export const MAX_WINNINGS_TAX_RATE = 0.95;

export function toMoney(value) {
  return decimalToMoney(value);
}

/**
 * @param {number} gross
 * @param {boolean} apply
 * @param {number|null|undefined} rate decimal, e.g. 0.15
 */
export function computeWinningsTaxBreakdown(gross, apply, rate) {
  const g = toMoney(gross);
  if (
    !apply ||
    rate == null ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return { taxAmount: 0, netPayout: g };
  }
  const taxAmount = toMoney(d(g).mul(rate));
  const netPayout = toMoney(d(g).sub(taxAmount));
  return { taxAmount, netPayout };
}

function parseEnabledFromStored(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function parseRateFromStored(raw) {
  if (raw == null || raw === "") return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_WINNINGS_TAX_RATE || parsed > MAX_WINNINGS_TAX_RATE) {
    return null;
  }
  return parsed;
}

/**
 * Effective platform tax settings for new tickets and public config.
 *
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function resolveWinningsTax(prismaClient) {
  const [enabledRow, rateRow] = await Promise.all([
    prismaClient.setting.findUnique({
      where: { key: WINNINGS_TAX_ENABLED_SETTING_KEY },
    }),
    prismaClient.setting.findUnique({
      where: { key: WINNINGS_TAX_RATE_SETTING_KEY },
    }),
  ]);

  let enabled = DEFAULT_WINNINGS_TAX_ENABLED;
  const parsedEnabled = parseEnabledFromStored(enabledRow?.value);
  if (parsedEnabled != null) enabled = parsedEnabled;

  let rate = DEFAULT_WINNINGS_TAX_RATE;
  const parsedRate = parseRateFromStored(rateRow?.value);
  if (parsedRate != null) rate = parsedRate;

  return {
    enabled,
    rate,
    configuredInDatabase: Boolean(enabledRow || rateRow),
  };
}

/**
 * Prisma create/update payload fragment for new tickets.
 *
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function snapshotWinningsTaxForNewTicket(prismaClient) {
  const { enabled, rate } = await resolveWinningsTax(prismaClient);
  const apply = Boolean(enabled && rate > 0);
  return {
    apply_winnings_tax: apply,
    winnings_tax_rate: apply ? rate : null,
  };
}

/**
 * @param {import("@prisma/client").Ticket | { apply_winnings_tax?: boolean; winnings_tax_rate?: number|null; potential_win?: number }} ticket
 */
export function ticketWinningsTaxBreakdown(ticket) {
  const gross = Number(ticket?.potential_win ?? 0);
  const apply = Boolean(ticket?.apply_winnings_tax);
  const rate =
    ticket?.winnings_tax_rate != null
      ? Number(ticket.winnings_tax_rate)
      : null;
  return computeWinningsTaxBreakdown(gross, apply, rate);
}
