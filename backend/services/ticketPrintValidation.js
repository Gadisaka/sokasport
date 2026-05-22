import { validatePlacementSelections } from "./odds-engine/validateSelections.js";

/**
 * Build normalized selection rows from ticket snapshot for print validation.
 */
export function normalizeSnapshotForPrintValidation(
  snapshotSelections = [],
  requestBody = {},
) {
  const acceptedOddsByIndex = new Map();
  const acceptedVersionsByIndex = new Map();
  if (Array.isArray(requestBody.selections)) {
    for (const row of requestBody.selections) {
      const idx = Number.parseInt(row?.index, 10);
      const accepted = Number(row?.acceptedOdds);
      const acceptedVersion = Number(
        row?.acceptedMarketVersion ?? row?.marketVersion,
      );
      if (Number.isFinite(idx) && Number.isFinite(accepted)) {
        acceptedOddsByIndex.set(idx, accepted);
      }
      if (Number.isFinite(idx) && Number.isFinite(acceptedVersion)) {
        acceptedVersionsByIndex.set(idx, acceptedVersion);
      }
    }
  }

  const normalized = snapshotSelections.map((entry, index) => ({
    apiFixtureId: Number.parseInt(entry?.apiFixtureId, 10),
    marketLabel: String(entry?.marketLabel || "").trim(),
    marketCode: entry?.marketCode ? String(entry.marketCode).trim() : null,
    marketParams:
      entry?.marketParams && typeof entry.marketParams === "object"
        ? entry.marketParams
        : null,
    label: String(entry?.label || "").trim(),
    odds: Number.isFinite(acceptedOddsByIndex.get(index))
      ? acceptedOddsByIndex.get(index)
      : Number(entry?.odds),
    marketVersion: Number.isFinite(acceptedVersionsByIndex.get(index))
      ? acceptedVersionsByIndex.get(index)
      : Number(entry?.marketVersion),
    fromLive: false,
  }));

  const fullyStructured = normalized.every(
    (row) =>
      Number.isFinite(Number(row.apiFixtureId)) &&
      row.marketLabel &&
      row.label &&
      Number.isFinite(Number(row.odds)),
  );

  return { normalized, fullyStructured };
}

/**
 * Dry-run validation for OPEN ticket print (no wallet debit).
 *
 * @returns {Promise<{ ok: true, validated: object, normalized: object[] } | { ok: false, statusCode: number, body: object, logCode: string, logMeta?: object }>}
 */
export async function validateOpenTicketForPrint({
  prismaClient,
  ticket,
  cashierId,
  requestBody = {},
  acceptOddsChanges = false,
}) {
  const snapshotSelections = Array.isArray(ticket?.selection_snapshot)
    ? ticket.selection_snapshot
    : [];

  if (snapshotSelections.length === 0) {
    return { ok: true, validated: null, normalized: [] };
  }

  const { normalized, fullyStructured } = normalizeSnapshotForPrintValidation(
    snapshotSelections,
    requestBody,
  );

  if (!fullyStructured) {
    return { ok: true, validated: null, normalized };
  }

  const validated = await validatePlacementSelections({
    prismaClient,
    rawSelections: normalized,
    live: false,
    actorId: `cashier:${cashierId}`,
    writeFreeze: false,
    now: new Date(),
  });

  if (!validated.ok && validated.code === "odds_changed") {
    return {
      ok: false,
      statusCode: 409,
      logCode: "odds_changed",
      logMeta: { ticketId: ticket.id, selections: validated.drift },
      body: {
        ok: false,
        code: "odds_changed",
        requiresConfirmation: true,
        message: "Odds changed. Review and confirm latest odds before print.",
        selections: validated.drift,
        newTotalOdds: Number(validated.totalOdds || 0),
        acceptOddsChanges,
      },
    };
  }

  if (!validated.ok && validated.code === "market_version_changed") {
    return {
      ok: false,
      statusCode: 409,
      logCode: "market_version_changed",
      logMeta: {
        ticketId: ticket.id,
        selections: validated.versionDrift || [],
      },
      body: {
        ok: false,
        code: "market_version_changed",
        requiresConfirmation: true,
        message: "Market version changed. Confirm latest market before print.",
        selections: validated.versionDrift || [],
        newTotalOdds: Number(validated.totalOdds || 0),
      },
    };
  }

  if (!validated.ok && validated.code === "market_locked") {
    return {
      ok: false,
      statusCode: 409,
      logCode: "market_locked",
      logMeta: { ticketId: ticket.id },
      body: {
        ok: false,
        code: "market_locked",
        selections: validated.selections || [],
      },
    };
  }

  if (!validated.ok) {
    return {
      ok: false,
      statusCode: 409,
      logCode: validated.code || "validation_failed",
      logMeta: { ticketId: ticket.id },
      body: {
        ok: false,
        code: validated.code || "validation_failed",
        selections: validated.selections || [],
      },
    };
  }

  return { ok: true, validated, normalized };
}
