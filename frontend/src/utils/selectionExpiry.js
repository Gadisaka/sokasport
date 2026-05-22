const TERMINAL = new Set([
  "FT",
  "AET",
  "PEN",
  "CANC",
  "PST",
  "ABD",
  "AWD",
  "WO",
  "INT",
]);

function normalizeStatus(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function isTerminalMatchStatus(status) {
  const u = normalizeStatus(status);
  if (!u) return false;
  if (TERMINAL.has(u.replace(/\s+/g, ""))) return true;
  if (TERMINAL.has(u)) return true;
  if (u.includes("FULL TIME") || u === "FULLTIME") return true;
  if (u.includes("FINISHED") || u.includes("FINISH")) return true;
  return u === "COMPLETE";
}

/**
 * Prematch: expired after kickoff (and when match is finished).
 * Live slip rows (`fromLive`): only finished / cancelled counts as expired.
 */
export function isSelectionExpired(sel, now = Date.now()) {
  if (!sel || typeof sel !== "object") return false;
  const st = sel.matchStatus ?? sel.status;
  if (isTerminalMatchStatus(st)) return true;

  if (sel.fromLive) return false;

  const kick = sel.kickoffAt;
  if (!kick) return false;

  const t = new Date(kick).getTime();
  if (Number.isNaN(t)) return false;
  return now >= t;
}

export function slipHasExpiredSelection(selections, now = Date.now()) {
  if (!Array.isArray(selections)) return false;
  return selections.some((s) => isSelectionExpired(s, now));
}
