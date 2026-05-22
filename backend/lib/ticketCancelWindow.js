/**
 * Ticket cancellation window — stored in `settings` table; admins update via
 * PUT /api/admin/settings/ticket-cancel-window
 */

/** DB row key for Prisma `Setting` */
export const TICKET_CANCEL_WINDOW_SETTING_KEY = "TICKET_CANCEL_WINDOW_MINUTES";

/** Used when no admin value exists yet or stored value is invalid */
export const DEFAULT_TICKET_CANCEL_WINDOW_MINUTES = 15;

/** Hard cap so a typo cannot lock out cancellations for years */
export const MAX_TICKET_CANCEL_WINDOW_MINUTES = 10080; // 7 days

/**
 * Effective minutes for cancel window (reads admin `Setting`, else default).
 * @param {import("@prisma/client").PrismaClient} prismaClient
 * @returns {Promise<number>}
 */
export async function resolveCancelWindowMinutes(prismaClient) {
  const row = await prismaClient.setting.findUnique({
    where: { key: TICKET_CANCEL_WINDOW_SETTING_KEY },
  });

  if (!row?.value) {
    return DEFAULT_TICKET_CANCEL_WINDOW_MINUTES;
  }

  const parsed = Number.parseInt(row.value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_TICKET_CANCEL_WINDOW_MINUTES;
  }

  return Math.min(parsed, MAX_TICKET_CANCEL_WINDOW_MINUTES);
}
