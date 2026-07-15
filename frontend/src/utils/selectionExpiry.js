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

/**
 * Drop expired legs. Returns the same array reference when nothing changed.
 */
export function pruneExpiredSelections(selections, now = Date.now()) {
  if (!Array.isArray(selections)) return selections;
  if (selections.length === 0) return selections;
  const next = selections.filter((s) => !isSelectionExpired(s, now));
  return next.length === selections.length ? selections : next;
}

function countRemovedAcrossSlips(before, after) {
  let n = 0;
  for (const key of ["betslip1", "betslip2", "betslip3"]) {
    n += (before?.[key]?.length || 0) - (after?.[key]?.length || 0);
  }
  return n;
}

/**
 * Prune expired legs from all slip tabs.
 * Returns the same slips object reference when nothing changed.
 */
export function pruneExpiredFromSlips(slips, now = Date.now()) {
  if (!slips || typeof slips !== "object") return slips;
  const n1 = pruneExpiredSelections(slips.betslip1, now);
  const n2 = pruneExpiredSelections(slips.betslip2, now);
  const n3 = pruneExpiredSelections(slips.betslip3, now);
  if (n1 === slips.betslip1 && n2 === slips.betslip2 && n3 === slips.betslip3) {
    return slips;
  }
  return { ...slips, betslip1: n1, betslip2: n2, betslip3: n3 };
}

/** Like pruneExpiredFromSlips, plus how many legs were dropped. */
export function pruneExpiredFromSlipsWithCount(slips, now = Date.now()) {
  const next = pruneExpiredFromSlips(slips, now);
  if (next === slips) return { slips, removedCount: 0 };
  return { slips: next, removedCount: countRemovedAcrossSlips(slips, next) };
}
