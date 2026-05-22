/**
 * Whether logged-in sportsbook UX should offer "Cancel ticket" before server call.
 */

export function playerOnlineCancelEligible({
  rawStatus,
  createdAt,
  selections,
  windowMinutes,
}) {
  const st = String(rawStatus || "").toUpperCase();
  if (st !== "OPEN" && st !== "PRINTED") return false;
  const w = Number(windowMinutes);
  if (!Number.isFinite(w) || w <= 0) return false;

  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const deadline = created.getTime() + w * 60 * 1000;
  if (Date.now() > deadline) return false;

  const now = new Date();
  for (const sel of selections || []) {
    const t = sel?.matchStartTime;
    if (!t) continue;
    const ko = new Date(t);
    if (!Number.isNaN(ko.getTime()) && ko <= now) return false;
  }
  return true;
}
