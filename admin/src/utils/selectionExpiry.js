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
 */
export function isSelectionExpired(sel, now = Date.now()) {
  if (!sel || typeof sel !== "object") return false;
  const st = sel.matchStatus ?? sel.status ?? sel.match?.status;
  if (isTerminalMatchStatus(st)) return true;

  if (sel.fromLive) return false;

  const kick = sel.kickoffAt ?? sel.match?.startTime;
  if (!kick) return false;

  const t = new Date(kick).getTime();
  if (Number.isNaN(t)) return false;
  return now >= t;
}

export function slipHasExpiredSelection(selections, now = Date.now()) {
  if (!Array.isArray(selections)) return false;
  return selections.some((s) => isSelectionExpired(s, now));
}

function selectionExpiryInput(selection) {
  return {
    kickoffAt: selection?.kickoffAt ?? selection?.match?.startTime,
    matchStatus:
      selection?.matchStatus ?? selection?.status ?? selection?.match?.status,
    status: selection?.match?.status ?? selection?.status,
    fromLive: selection?.fromLive,
  };
}

/**
 * Kickoff / terminal expiry only (not locked/suspended blocking legs).
 * @returns {string[]}
 */
export function collectExpiredSelectionIds(selections, now = Date.now()) {
  const ids = [];
  for (const selection of selections || []) {
    const id = String(selection?.id || "").trim();
    if (!id) continue;
    if (isSelectionExpired(selectionExpiryInput(selection), now)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Expired ids that can be removed while leaving at least one selection.
 * Prefers keeping a non-expired leg when any exist.
 * @returns {string[]}
 */
export function removableExpiredSelectionIds(selections, now = Date.now()) {
  const all = Array.isArray(selections) ? selections : [];
  if (all.length <= 1) return [];

  const expiredIds = new Set(collectExpiredSelectionIds(all, now));
  if (expiredIds.size === 0) return [];

  const hasNonExpired = all.some(
    (s) => !expiredIds.has(String(s?.id || "").trim()),
  );
  if (hasNonExpired) {
    return [...expiredIds];
  }

  // All expired — keep the first, remove the rest.
  const keepId = String(all[0]?.id || "").trim();
  return all
    .map((s) => String(s?.id || "").trim())
    .filter((id) => id && id !== keepId && expiredIds.has(id));
}

/** Merge server blocking ids with client kickoff expiry. */
export function isSelectionInvalid(selection, blockingSelectionIds, now = Date.now()) {
  const id = String(selection?.id || "");
  if (blockingSelectionIds?.has?.(id)) return true;
  return isSelectionExpired(
    {
      kickoffAt: selection?.match?.startTime,
      status: selection?.match?.status,
      fromLive: selection?.fromLive,
    },
    now,
  );
}

export function collectInvalidSelectionIds(selections, blockingLegs = [], now = Date.now()) {
  const ids = new Set(
    (blockingLegs || [])
      .map((leg) => String(leg?.selectionId || "").trim())
      .filter(Boolean),
  );
  for (const selection of selections || []) {
    if (
      isSelectionInvalid(selection, ids, now) &&
      String(selection?.id || "").trim()
    ) {
      ids.add(String(selection.id));
    }
  }
  return ids;
}

const INVALID_CODE_LABEL = {
  fixture_started: "Expired",
  market_locked: "Locked",
  market_suspended: "Suspended",
  unknown_fixture: "Invalid",
};

export function invalidSelectionLabel(selectionId, blockingLegs = []) {
  const leg = (blockingLegs || []).find(
    (row) => String(row?.selectionId) === String(selectionId),
  );
  if (leg?.code) return INVALID_CODE_LABEL[leg.code] || "Invalid";
  return "Expired";
}
