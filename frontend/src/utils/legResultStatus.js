import { isTerminalMatchStatus } from "./selectionExpiry";

/** Match statuses (admin enum + API-Sports codes) that mean "not started yet". */
const NOT_STARTED = new Set(["NS", "NOT_STARTED", "TBD", ""]);

/** Started but not yet final: live / half-time / suspended / interrupted. */
const IN_PROGRESS = new Set([
  "LIVE",
  "HT",
  "1H",
  "2H",
  "ET",
  "BT",
  "P",
  "INT",
  "SUSP",
  "SUSPENDED",
]);

function normalizeStatus(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * Classify one ticket leg into a display bucket for the Check-ticket page.
 *
 * Combines the settlement `result` (PENDING/WON/LOST/VOID) with the match
 * `status` so a still-pending leg can be split into "not finished" (in play /
 * postponed) vs "not played" (hasn't kicked off). Result takes precedence;
 * status only matters while the leg is still PENDING.
 *
 * @param {{ result?: string, status?: string|null, kickoffAt?: string|null }} sel
 * @param {number} [now]
 * @returns {"won"|"lost"|"postponed"|"notplayed"}
 */
export function classifyLegStatus(sel, now = Date.now()) {
  const result = String(sel?.result || "PENDING").toUpperCase();
  if (result === "WON") return "won";
  if (result === "LOST") return "lost";
  if (result === "VOID") return "postponed";

  // PENDING (or unknown): decide on match status.
  const status = normalizeStatus(sel?.status);

  // Finished / cancelled / postponed / abandoned — settled or void, not graded yet.
  if (isTerminalMatchStatus(status)) return "postponed";

  // In play, half-time, suspended, interrupted.
  if (IN_PROGRESS.has(status)) return "postponed";

  // Not started: white, unless kickoff already passed (sync lag) → postponed.
  if (NOT_STARTED.has(status)) {
    const kick = sel?.kickoffAt;
    if (kick) {
      const t = new Date(kick).getTime();
      if (!Number.isNaN(t) && now >= t) return "postponed";
    }
    return "notplayed";
  }

  // Unknown / unmapped status: degrade gracefully to "not played".
  return "notplayed";
}
