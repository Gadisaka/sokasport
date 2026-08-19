/**
 * Helpers for cashier sell-flow selection edits.
 */

export function resolveSelectionIndex(ticket, selectionId) {
  const raw = String(selectionId || "").trim();
  if (!raw || !ticket) return -1;

  const snapshotPrefix = `snapshot-${ticket.id}-`;
  if (raw.startsWith(snapshotPrefix)) {
    const n = Number.parseInt(raw.slice(snapshotPrefix.length), 10);
    if (Number.isFinite(n) && n >= 1) return n - 1;
  }

  const rows = ticket.selections || [];
  const idx = rows.findIndex((row) => String(row.id) === raw);
  return idx;
}

export function productOddsFromSnapshotEntries(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return 1;
  return snapshot.reduce((acc, row) => acc * Number(row?.odds || 1), 1);
}

export function selectionIdForTicketLeg(ticket, index) {
  const dbRow = ticket?.selections?.[index];
  if (dbRow?.id) return String(dbRow.id);
  return `snapshot-${ticket.id}-${index + 1}`;
}

/**
 * Delete-time checks for removing one OPEN-ticket leg.
 * Does not run placement validation — print/sell does that later.
 *
 * @returns {{
 *   ok: true,
 *   selectionIndex: number,
 *   targetSelection: object,
 *   remainingSelections: object[],
 *   nextTotalOdds: number,
 * } | {
 *   ok: false,
 *   status: number,
 *   message: string,
 * }}
 */
export function evaluateTicketSelectionRemoval(selections, selectionId) {
  const rows = Array.isArray(selections) ? selections : [];
  const selectionIndex = rows.findIndex(
    (row) => String(row.id) === String(selectionId),
  );
  if (selectionIndex < 0) {
    return {
      ok: false,
      status: 404,
      message: "Selection not found on ticket",
    };
  }
  if (rows.length <= 1) {
    return {
      ok: false,
      status: 400,
      message: "At least one selection is required on the ticket",
    };
  }

  const remainingSelections = rows.filter((_, idx) => idx !== selectionIndex);
  const nextTotalOdds = remainingSelections.reduce(
    (product, row) => product * Number(row.odds || 1),
    1,
  );
  if (!Number.isFinite(nextTotalOdds) || nextTotalOdds <= 1) {
    return {
      ok: false,
      status: 400,
      message: "Remaining selections odds are invalid",
    };
  }

  return {
    ok: true,
    selectionIndex,
    targetSelection: rows[selectionIndex],
    remainingSelections,
    nextTotalOdds,
  };
}
