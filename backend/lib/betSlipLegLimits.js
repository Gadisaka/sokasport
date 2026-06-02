export const MIN_TICKET_LEGS = 1;
export const MAX_TICKET_LEGS = 20;

/**
 * @param {number} count
 * @returns {string|null} error message when invalid
 */
export function validateTicketLegCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < MIN_TICKET_LEGS) {
    return `A ticket must have at least ${MIN_TICKET_LEGS} match.`;
  }
  if (n > MAX_TICKET_LEGS) {
    return `A ticket cannot have more than ${MAX_TICKET_LEGS} matches.`;
  }
  return null;
}
