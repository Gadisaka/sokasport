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
 * Classify one ticket leg into a display bucket for payout lookup rows.
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

  const status = normalizeStatus(sel?.status);

  if (isTerminalMatchStatus(status)) return "postponed";
  if (IN_PROGRESS.has(status)) return "postponed";

  if (NOT_STARTED.has(status)) {
    const kick = sel?.kickoffAt;
    if (kick) {
      const t = new Date(kick).getTime();
      if (!Number.isNaN(t) && now >= t) return "postponed";
    }
    return "notplayed";
  }

  return "notplayed";
}

const ROW_CLASS_BY_BUCKET = {
  won: "bg-[#dcfce7]",
  lost: "bg-[#fee2e2]",
  postponed: "bg-[#fef9c3]",
  notplayed: "",
};

/** Tailwind row background for payout lookup selection rows. */
export function getSelectionRowClass(selection) {
  const bucket = classifyLegStatus({
    result: selection?.result,
    status: selection?.match?.status,
    kickoffAt: selection?.match?.startTime,
  });
  return ROW_CLASS_BY_BUCKET[bucket] ?? "";
}
