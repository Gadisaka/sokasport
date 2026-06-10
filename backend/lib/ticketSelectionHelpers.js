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
