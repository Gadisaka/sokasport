/**
 * Ticket engine controller — create, list, detail, cancel, void, payout.
 *
 * Business rules (see docs/ticket-engine.md):
 * - Cancel: OPEN only, within admin-configured window (`settings` table + GET/PUT
 *   `/api/admin/settings/ticket-cancel-window`), no match started
 * - Payout: WON only, `ticket.cashier_id` must match body `cashierId` (selling cashier)
 * - Void: admin; cannot void PAID
 *
 * Payout credits the cashier wallet and writes a PAYOUT transaction (per wallet-system.md).
 *
 * @module controllers/ticketsController
 */
import { prisma } from "../Config/db.js";
import {
  resolveBettingLimits,
  getStakeAndPotentialWinViolation,
  capGrossPotentialWin,
} from "../lib/bettingLimits.js";
import { resolveCancelWindowMinutes } from "../lib/ticketCancelWindow.js";
import {
  snapshotWinningsTaxForNewTicket,
  ticketWinningsTaxBreakdown,
} from "../lib/winningsTax.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { perfSpan, slowThresholdMs } from "../lib/perfTiming.js";
import { notifyUserSafe } from "../lib/createNotification.js";
import { betPlacedNotification } from "../lib/notificationMessages.js";
import { resolveAccumulatorForNewTicket } from "../lib/bonusEngine.js";
import { refundTicketStakeInTx } from "../services/ticketCancelRefund.js";
import {
  abortCashierPrintHoldInTx,
  findCashierPrintBet,
  holdCashierPrintInTx,
} from "../services/cashierPrintHold.js";
import { classifySelectionSupport } from "../services/markets/marketSupport.js";
import { validatePlacementSelections } from "../services/odds-engine/validateSelections.js";
import { validateOpenTicketForPrint, collectSellBlockingLegs } from "../services/ticketPrintValidation.js";
import { evaluateTicketSelectionRemoval } from "../lib/ticketSelectionHelpers.js";
import { getCache, setCache } from "../services/cacheService.js";
import { withWalletLock } from "../lib/walletLock.js";
import {
  commitHeldTicket,
  refundHeldTicket,
} from "../services/heldTicketService.js";
import { logPlacementValidation } from "../lib/placementValidationLogger.js";
import { debitWallet } from "../lib/walletBalance.js";
import {
  buildCouponNumber,
  couponLookupCandidates,
  normalizeCouponLookupInput,
} from "../lib/couponNumber.js";
import { resolvePublicTicketOutcome } from "../lib/publicTicketOutcome.js";
import {
  ticketListDateField,
  ticketListOrderBy,
} from "../lib/ticketPayday.js";

const LIVE_ACCEPTANCE_DELAY_MS = Math.max(
  0,
  Number(process.env.LIVE_ACCEPTANCE_DELAY_MS || 2500),
);
const LIVE_HOLD_MAX_CONCURRENT = Math.max(
  0,
  Number(process.env.LIVE_HOLD_MAX_CONCURRENT || 150),
);
const LIVE_HOLD_FAIL_CLOSED =
  String(process.env.LIVE_HOLD_FAIL_CLOSED ?? "true").toLowerCase() !== "false";
let liveHoldsInFlight = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a raw selection via the V2 market registry.
 *
 * Returns `{ marketCode, marketParams }`. Throws either
 * `MarketUnknownError` or `ValidationError` — both extend `Error` and
 * carry a `.code` the controller serializes into the 400 body.
 *
 * `input` accepts whichever shape the two callers use today:
 *   - createTicket:        { marketCode?, marketLabel?, marketParams?, selection? }
 *   - createPrebookTicket: { marketCode?, marketLabel?, marketParams?, label? }
 */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Case/whitespace-insensitive match of a submitted cashier leg against the
// admin-managed Odd rows for its match. Fail-closed contract: missing row →
// odds_not_found, all matching rows disabled → market_suspended, price drift
// beyond a rounding epsilon → odds_changed (serverOdds included for the UI).
function verifyCashierSelectionOdds(oddRowsForMatch, item) {
  const norm = (value) => String(value ?? "").trim().toLowerCase();
  const wantSelection = norm(item.selection);
  const wantMarkets = [norm(item.marketLabel), norm(item.marketCode)].filter(
    Boolean,
  );
  const candidates = (oddRowsForMatch || []).filter(
    (row) =>
      norm(row.selection) === wantSelection &&
      wantMarkets.includes(norm(row.market)),
  );
  if (candidates.length === 0) {
    return { ok: false, code: "odds_not_found" };
  }
  const active = candidates.filter((row) => row.status !== false);
  if (active.length === 0) {
    return { ok: false, code: "market_suspended" };
  }
  const submitted = Number(item.odds);
  const matched = active.find(
    (row) => Math.abs(Number(row.odds) - submitted) <= 0.001,
  );
  if (!matched) {
    return {
      ok: false,
      code: "odds_changed",
      serverOdds: Number(active[0].odds),
    };
  }
  return { ok: true, serverOdds: Number(matched.odds) };
}

const CASHIER_PROFILE_MISSING_MESSAGE =
  "Cashier profile not found. Ask admin to create/assign this cashier in Agents & Cashiers.";

/** Unique payout id — #####-##### (digits). Uniqueness enforced when assigning (Mongo has no sparse unique in Prisma). */
function buildReceiptNumber() {
  const a = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  const b = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  return `${a}-${b}`;
}

const RECEIPT_ASSIGN_MAX_ATTEMPTS = 12;
const COUPON_ASSIGN_MAX_ATTEMPTS = 12;

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 * @returns {Promise<string>}
 */
async function reserveUniqueCouponNumber(client) {
  for (let i = 0; i < COUPON_ASSIGN_MAX_ATTEMPTS; i++) {
    const candidate = buildCouponNumber();
    const clash = await client.ticket.findFirst({
      where: { coupon_number: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("COUPON_NUMBER_EXHAUSTED");
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 * @returns {Promise<string>}
 */
async function reserveUniqueReceiptNumber(client) {
  for (let i = 0; i < RECEIPT_ASSIGN_MAX_ATTEMPTS; i++) {
    const candidate = buildReceiptNumber();
    const clash = await client.ticket.findFirst({
      where: { receipt_number: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("RECEIPT_NUMBER_EXHAUSTED");
}

function stableMarketParams(params) {
  if (params == null || typeof params !== "object" || Array.isArray(params)) {
    return params ?? null;
  }
  const keys = Object.keys(params).sort();
  /** @type {Record<string, unknown>} */
  const out = Object.create(null);
  for (const k of keys) {
    const v = params[k];
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = stableMarketParams(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** @param {import("@prisma/client").TicketSelection & { fixture?: { api_fixture_id?: number|null }|null; match?: { id?: string }|null }} sel */
function eventKeyFromDbSelection(sel) {
  const apiFixtureId = sel.fixture?.api_fixture_id;
  if (apiFixtureId != null && Number.isFinite(Number(apiFixtureId))) {
    return `f:${Number(apiFixtureId)}`;
  }
  if (sel.match_id) {
    return `m:${sel.match_id}`;
  }
  if (sel.fixture_id) {
    return `fid:${sel.fixture_id}`;
  }
  return `u:${sel.id || "?"}`;
}

/** @param {ReturnType<typeof canonicalRowsFromDbSelections>[number] extends infer U ? U : never} row */
function roundOdds(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {Array<import("@prisma/client").TicketSelection & { fixture?: { api_fixture_id?: number|null }|null; match?: { id?: string }|null }>} selections
 */
function canonicalRowsFromDbSelections(selections) {
  return (selections ?? []).map((sel) => ({
    eventKey: eventKeyFromDbSelection(sel),
    marketCode: sel.market_code
      ? String(sel.market_code).toUpperCase().trim()
      : "",
    marketParams: stableMarketParams(sel.market_params),
    selection: String(sel.selection || "").trim(),
    odds: roundOdds(sel.odds),
  }));
}

function canonicalRowsFromCashierPrepared(prepared) {
  return prepared.map((p) => ({
    eventKey: p.match_id ? `m:${p.match_id}` : "m:?",
    marketCode: p.market_code ? String(p.market_code).toUpperCase().trim() : "",
    marketParams: stableMarketParams(p.market_params),
    selection: String(p.selection || "").trim(),
    odds: roundOdds(p.odds),
  }));
}

/**
 * @param {Array<{ apiFixtureId: number|null; label: string; marketCode?: string|null; marketParams?: unknown; odds: number }>} normalizedSelections
 */
function canonicalRowsFromPrebook(normalizedSelections) {
  return normalizedSelections.map((item, idx) => {
    const apiId = item.apiFixtureId;
    const eventKey =
      apiId != null && Number.isFinite(apiId)
        ? `f:${Number(apiId)}`
        : `f:null:${idx}`;
    return {
      eventKey,
      marketCode: item.marketCode
        ? String(item.marketCode).toUpperCase().trim()
        : "",
      marketParams: stableMarketParams(item.marketParams),
      selection: String(item.label || "").trim(),
      odds: roundOdds(item.odds),
    };
  });
}

/** @param {ReturnType<typeof canonicalRowsFromDbSelections>} rows */
function canonicalLegsSignature(rows) {
  const sorted = [...rows].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  return JSON.stringify(sorted);
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 * @param {unknown} couponRaw
 * @param {string} incomingSignature
 * @returns {Promise<string>}
 */
async function resolveCouponNumberForCreate(
  client,
  couponRaw,
  incomingSignature,
) {
  const trimmed = String(couponRaw ?? "").trim();
  if (!trimmed) {
    return reserveUniqueCouponNumber(client);
  }

  const { compact, compactLower } = normalizeCouponLookupInput(trimmed);
  const candidates = couponLookupCandidates(compact, compactLower);
  if (!candidates.length) {
    throw Object.assign(new Error("COUPON_REUSE_UNKNOWN"), {
      code: "COUPON_REUSE_UNKNOWN",
    });
  }

  const template = await client.ticket.findFirst({
    where: { coupon_number: { in: candidates } },
    include: {
      selections: ticketSelectionRelationArgs,
    },
  });

  if (!template?.selections?.length) {
    throw Object.assign(new Error("COUPON_REUSE_UNKNOWN"), {
      code: "COUPON_REUSE_UNKNOWN",
    });
  }

  const templateSig = canonicalLegsSignature(
    canonicalRowsFromDbSelections(template.selections),
  );
  if (templateSig !== incomingSignature) {
    throw Object.assign(new Error("COUPON_SELECTIONS_MISMATCH"), {
      code: "COUPON_SELECTIONS_MISMATCH",
    });
  }

  return String(template.coupon_number).toLowerCase();
}

async function resolveCashierByUserId(userId) {
  if (!userId) return null;
  return prisma.cashier.findUnique({
    where: { user_id: userId },
  });
}

async function assertOpenTicketEditable(req, ticketId, { includeSelections = false } = {}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: includeSelections ? ticketDetailInclude : undefined,
  });
  if (!ticket) {
    return { error: { status: 404, message: "Ticket not found" } };
  }
  if (ticket.status !== "OPEN") {
    return {
      error: {
        status: 400,
        message: "Only OPEN tickets can be edited before print",
      },
    };
  }

  if (req.user.role === "CASHIER") {
    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return {
        error: { status: 404, message: CASHIER_PROFILE_MISSING_MESSAGE },
      };
    }
    if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
      return { error: { status: 403, message: "Access denied" } };
    }
  }

  const existingPrint = await findCashierPrintBet(prisma, ticket.id);
  if (existingPrint) {
    return {
      error: {
        status: 400,
        message: "Ticket cannot be changed after it has been printed",
      },
    };
  }

  return { ticket };
}

async function getPrintedTicketIdSet({ cashierId, ticketIds }) {
  if (!cashierId || !Array.isArray(ticketIds) || ticketIds.length === 0) {
    return new Set();
  }

  const cashier = await prisma.cashier.findUnique({
    where: { id: cashierId },
    select: { wallet_id: true },
  });
  if (!cashier?.wallet_id) return new Set();

  const refs = ticketIds.map((ticketId) => `ticket-print:${ticketId}`);
  const prints = await prisma.transaction.findMany({
    where: {
      wallet_id: cashier.wallet_id,
      type: "BET",
      reference: { in: refs },
    },
    select: { reference: true },
  });

  return new Set(
    prints
      .map((entry) =>
        String(entry.reference || "").replace("ticket-print:", ""),
      )
      .filter(Boolean),
  );
}

function parseTeamsFromMatchName(matchName) {
  const text = String(matchName || "").trim();
  if (!text) return { homeTeam: "Match", awayTeam: "" };
  const parts = text.split(/\s+vs\s+/i);
  if (parts.length >= 2) {
    return {
      homeTeam: String(parts[0] || "").trim() || "Match",
      awayTeam: String(parts.slice(1).join(" vs ") || "").trim(),
    };
  }
  return { homeTeam: text, awayTeam: "" };
}

/** Prisma include for ticket legs: admin Match path + sportsbook Fixture path */
const ticketSelectionRelationArgs = {
  include: {
    match: { include: { league: true } },
    fixture: {
      include: {
        home_team: true,
        away_team: true,
        league: true,
      },
    },
  },
};

/** Full ticket payload for mapTicket — selections + selling cashier display name */
const ticketDetailInclude = {
  selections: ticketSelectionRelationArgs,
  cashier: {
    include: {
      user: { select: { fullname: true } },
    },
  },
};

function selectionKickoffTime(selection) {
  return selection.match?.start_time ?? selection.fixture?.start_time ?? null;
}

function parseLeagueString(leagueRaw) {
  const leagueStr = String(leagueRaw || "").trim();
  if (!leagueStr) return { country: "", leagueName: "" };
  const sep = leagueStr.indexOf(" - ");
  if (sep === -1) {
    return { country: "", leagueName: leagueStr };
  }
  return {
    country: leagueStr.slice(0, sep).trim(),
    leagueName: leagueStr.slice(sep + 3).trim(),
  };
}

function leagueMetaFromSelection(selection, snapshotEntry) {
  const leagueFromFixture = selection?.fixture?.league;
  if (leagueFromFixture) {
    return {
      country: String(leagueFromFixture.country || "").trim() || "Unknown",
      leagueName: String(leagueFromFixture.name || "").trim() || "League",
    };
  }
  const leagueFromMatch = selection?.match?.league;
  if (leagueFromMatch) {
    return {
      country: String(leagueFromMatch.country || "").trim() || "Unknown",
      leagueName: String(leagueFromMatch.name || "").trim() || "League",
    };
  }
  if (snapshotEntry?.league) {
    const parsed = parseLeagueString(snapshotEntry.league);
    return {
      country: parsed.country || "Unknown",
      leagueName: parsed.leagueName || "League",
    };
  }
  return { country: "", leagueName: "" };
}

function buildMatchPayloadForTicketSelection(selection, snapshotEntry) {
  const leagueMeta = leagueMetaFromSelection(selection, snapshotEntry);
  if (selection.match) {
    return {
      id: selection.match.id,
      homeTeam: selection.match.home_team,
      awayTeam: selection.match.away_team,
      startTime: selection.match.start_time,
      status: selection.match.status,
      country: leagueMeta.country,
      leagueCountry: leagueMeta.country,
      leagueName: leagueMeta.leagueName,
    };
  }
  if (selection.fixture) {
    const f = selection.fixture;
    return {
      id: f.id,
      homeTeam: f.home_team?.name || "Home",
      awayTeam: f.away_team?.name || "Away",
      startTime: f.start_time,
      status: f.status,
      country: leagueMeta.country,
      leagueCountry: leagueMeta.country,
      leagueName: leagueMeta.leagueName,
    };
  }
  if (snapshotEntry?.matchName) {
    const teams = parseTeamsFromMatchName(snapshotEntry.matchName);
    return {
      id: null,
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      startTime: null,
      status: "NOT_STARTED",
      country: leagueMeta.country,
      leagueCountry: leagueMeta.country,
      leagueName: leagueMeta.leagueName,
    };
  }
  return null;
}

function mapSnapshotSelections(ticket) {
  const raw = Array.isArray(ticket?.selection_snapshot)
    ? ticket.selection_snapshot
    : [];
  return raw.map((entry, idx) => {
    const teams = parseTeamsFromMatchName(entry?.matchName);
    const leagueMeta = leagueMetaFromSelection(null, entry);
    return {
      id: `snapshot-${ticket.id}-${idx + 1}`,
      matchId: null,
      selection: String(entry?.label || ""),
      odds: Number(entry?.odds || 0),
      result: "PENDING",
      match: {
        id: null,
        homeTeam: teams.homeTeam,
        awayTeam: teams.awayTeam,
        startTime: null,
        status: "NOT_STARTED",
        country: leagueMeta.country,
        leagueCountry: leagueMeta.country,
        leagueName: leagueMeta.leagueName,
      },
      marketLabel: String(entry?.marketLabel || ""),
    };
  });
}

/** Normalize DB ticket + nested selections/matches for JSON responses */
function mapTicket(ticket, { printed = false } = {}) {
  const snapshot = Array.isArray(ticket.selection_snapshot)
    ? ticket.selection_snapshot
    : [];
  const normalSelections =
    ticket.selections?.map((selection, index) => {
      const snap = snapshot[index];
      const matchPayload = buildMatchPayloadForTicketSelection(selection, snap);
      const marketLabelFromSnap = String(snap?.marketLabel ?? "").trim();
      const marketLabel =
        marketLabelFromSnap ||
        (selection.market_code ? String(selection.market_code) : "");
      return {
        id: selection.id,
        matchId: selection.match_id,
        fixtureId: selection.fixture_id,
        selection: selection.selection,
        odds: selection.odds,
        result: selection.result,
        match: matchPayload,
        marketLabel,
      };
    }) ?? [];
  const snapshotSelections =
    normalSelections.length === 0 ? mapSnapshotSelections(ticket) : [];

  const taxBreakdown = ticketWinningsTaxBreakdown(ticket);

  return {
    id: ticket.id,
    couponNumber: ticket.coupon_number,
    receiptNumber: ticket.receipt_number ?? null,
    userId: ticket.user_id,
    cashierId: ticket.cashier_id,
    cashierName: ticket.cashier?.user?.fullname ?? null,
    branchName: ticket.branch_name,
    branchLocation: ticket.branch_location,
    stake: ticket.stake,
    totalOdds: ticket.total_odds,
    accumulatorBonusPercent: Number(ticket.accumulator_bonus_percent) || 0,
    potentialWin: ticket.potential_win,
    applyWinningsTax: Boolean(ticket.apply_winnings_tax),
    winningsTaxRate: ticket.winnings_tax_rate ?? null,
    winningsTaxAmount: taxBreakdown.taxAmount,
    netPayout: taxBreakdown.netPayout,
    status: ticket.status,
    createdAt: ticket.created_at,
    paidAt: ticket.paid_at ?? null,
    printed,
    selections:
      normalSelections.length > 0 ? normalSelections : snapshotSelections,
  };
}

function toIsoOrNull(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Public sportsbook coupon lookup — no cashier/player PII. */
async function mapPublicCouponPayload(ticket) {
  const snapshot = Array.isArray(ticket.selection_snapshot)
    ? ticket.selection_snapshot
    : [];
  const rows = ticket.selections ?? [];

  const selectionLegs =
    rows.length > 0
      ? rows.map((selection, index) => {
          const snap = snapshot[index] ?? {};
          const matchPayload = buildMatchPayloadForTicketSelection(
            selection,
            snap,
          );
          const marketLabelFromSnap = String(snap?.marketLabel ?? "").trim();
          const marketLabel =
            marketLabelFromSnap ||
            (selection.market_code ? String(selection.market_code).trim() : "");
          const home = matchPayload?.homeTeam ?? "";
          const away = matchPayload?.awayTeam ?? "";
          const derivedMatchName =
            away && `${String(away).trim()}`.length > 0
              ? `${home} vs ${away}`
              : String(home || "Match");

          let apiFixtureNum = null;
          const fromSnap = snap?.apiFixtureId;
          if (
            fromSnap != null &&
            !Number.isNaN(Number.parseInt(fromSnap, 10))
          ) {
            apiFixtureNum = Number.parseInt(fromSnap, 10);
          } else if (selection.fixture?.api_fixture_id != null) {
            apiFixtureNum = selection.fixture.api_fixture_id;
          }

          const start =
            snap?.kickoffAt != null
              ? snap.kickoffAt
              : selectionKickoffTime(selection);
          const kickoffAt = toIsoOrNull(start);

          return {
            matchName: String(snap?.matchName ?? "").trim() || derivedMatchName,
            marketLabel,
            label: String(snap?.label ?? selection.selection ?? "").trim(),
            odds: Number(selection.odds),
            apiFixtureId: apiFixtureNum,
            marketCode: snap?.marketCode ?? selection.market_code ?? null,
            marketParams: snap?.marketParams ?? selection.market_params ?? null,
            kickoffAt,
            result: selection.result ?? "PENDING",
            status: matchPayload?.status ?? null,
          };
        })
      : snapshot.map((snap) => {
          const teams = parseTeamsFromMatchName(snap?.matchName);
          const derivedMatchName =
            teams.awayTeam && String(teams.awayTeam).trim()
              ? `${teams.homeTeam} vs ${teams.awayTeam}`
              : teams.homeTeam || "Match";
          let apiFixtureNum = null;
          const fromSnap = snap?.apiFixtureId;
          if (
            fromSnap != null &&
            !Number.isNaN(Number.parseInt(fromSnap, 10))
          ) {
            apiFixtureNum = Number.parseInt(fromSnap, 10);
          }
          return {
            matchName: String(snap?.matchName ?? "").trim() || derivedMatchName,
            marketLabel: String(snap?.marketLabel ?? "").trim(),
            label: String(snap?.label ?? "").trim(),
            odds: Number(snap?.odds ?? 0),
            apiFixtureId: apiFixtureNum,
            marketCode: snap?.marketCode ?? null,
            marketParams: snap?.marketParams ?? null,
            kickoffAt: toIsoOrNull(snap?.kickoffAt),
            result: "PENDING",
            status: null,
          };
        });

  const taxBreakdown = ticketWinningsTaxBreakdown(ticket);
  const { outcome, outcomeAmount } = await resolvePublicTicketOutcome(
    prisma,
    ticket,
  );

  return {
    couponNumber: ticket.coupon_number,
    receiptNumber: ticket.receipt_number ?? null,
    status: ticket.status,
    stake: ticket.stake,
    totalOdds: ticket.total_odds,
    potentialWin: ticket.potential_win,
    applyWinningsTax: Boolean(ticket.apply_winnings_tax),
    winningsTaxRate: ticket.winnings_tax_rate ?? null,
    winningsTaxAmount: taxBreakdown.taxAmount,
    netPayout: taxBreakdown.netPayout,
    outcome,
    outcomeAmount,
    selections: selectionLegs,
  };
}

/**
 * Normalize receipt input (#####-#####).
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeReceiptLookupInput(raw) {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/\ufeff/g, "").trim();
  s = s.replace(/[\u00a0\u200b-\u200d\ufeff]/g, "").trim();
  return s.replace(/\s+/g, "");
}

/**
 * GET /api/cms/ticket-by-coupon?couponNumber=
 * Public read — exact coupon match, minimal fields for check / load slip flows.
 */
export async function getPublicCouponTicket(req, res) {
  try {
    const queryRaw = req.query.couponNumber ?? req.query.coupon ?? "";
    const { compact, compactLower } = normalizeCouponLookupInput(queryRaw);
    if (!compactLower) {
      return res.status(400).json({ message: "couponNumber is required" });
    }

    const candidates = couponLookupCandidates(compact, compactLower);

    const ticketInclude = {
      selections: ticketSelectionRelationArgs,
    };

    const ticket = await prisma.ticket.findFirst({
      where: { coupon_number: { in: candidates } },
      include: ticketInclude,
    });

    if (!ticket) {
      return res.status(404).json({
        message: "Ticket not found",
        code: "TICKET_NOT_FOUND",
      });
    }

    return res.json(await mapPublicCouponPayload(ticket));
  } catch (error) {
    console.error("getPublicCouponTicket error:", error);
    return res.status(500).json({ message: "Failed to load ticket" });
  }
}

/**
 * GET /api/cms/ticket-by-receipt?receiptNumber=
 * Public read — exact receipt match for check-ticket flows.
 */
export async function getPublicReceiptTicket(req, res) {
  try {
    const compact = normalizeReceiptLookupInput(
      req.query.receiptNumber ?? req.query.receipt ?? "",
    );
    if (!compact) {
      return res.status(400).json({ message: "receiptNumber is required" });
    }

    const ticketInclude = {
      selections: ticketSelectionRelationArgs,
    };

    const ticket = await prisma.ticket.findFirst({
      where: { receipt_number: compact },
      include: ticketInclude,
    });

    if (!ticket || !ticket.receipt_number) {
      return res.status(404).json({
        message: "Ticket not found",
        code: "TICKET_NOT_FOUND",
      });
    }

    return res.json(await mapPublicCouponPayload(ticket));
  } catch (error) {
    console.error("getPublicReceiptTicket error:", error);
    return res.status(500).json({ message: "Failed to load ticket" });
  }
}

/**
 * POST /api/tickets
 * Body: { userId?, cashierId, stake, selections: [{ matchId, selection, odds }] }
 * Branch name/location are sourced from the cashier's profile.
 * One selection per match; matches must not be SUSPENDED/FINISHED.
 */
export async function createTicket(req, res) {
  try {
    const {
      userId = null,
      cashierId,
      stake,
      selections,
      couponNumber: rawCoupon,
    } = req.body ?? {};

    if (
      !cashierId ||
      !stake ||
      !Array.isArray(selections) ||
      selections.length === 0
    ) {
      return res.status(400).json({
        message: "cashierId, stake and selections[] are required",
      });
    }

    const cashier = await prisma.cashier.findUnique({
      where: { id: cashierId },
      select: { id: true, branch_name: true, branch_location: true },
    });
    if (!cashier) {
      return res.status(400).json({ message: "Invalid cashierId" });
    }

    const numericStake = Number(stake);
    if (!Number.isFinite(numericStake) || numericStake <= 0) {
      return res
        .status(400)
        .json({ message: "stake must be a positive number" });
    }

    // Enforce one leg per match (accumulator / multi-bet)
    const matchIds = [
      ...new Set(selections.map((item) => item.matchId).filter(Boolean)),
    ];
    if (matchIds.length !== selections.length) {
      return res
        .status(400)
        .json({ message: "Each selection must have a unique matchId" });
    }

    const matches = await prisma.match.findMany({
      where: { id: { in: matchIds } },
      select: { id: true, status: true },
    });

    if (matches.length !== matchIds.length) {
      return res
        .status(400)
        .json({ message: "One or more matches do not exist" });
    }

    const blockedMatch = matches.find(
      (match) => match.status === "SUSPENDED" || match.status === "FINISHED",
    );
    if (blockedMatch) {
      return res.status(400).json({
        message: "Cannot create ticket with suspended/finished matches",
      });
    }

    // Server-odds verification: this legacy path used to trust client odds
    // verbatim, letting a compromised/forged request book any price. Verify
    // every leg against the admin-managed Odd table and fail closed on a
    // missing, disabled, or drifted price. CASHIER_TICKET_ODDS_VERIFY=false
    // restores the old trust-the-client behavior.
    const verifyCashierOdds =
      String(process.env.CASHIER_TICKET_ODDS_VERIFY ?? "true").toLowerCase() !==
      "false";
    const oddRowsByMatch = new Map();
    if (verifyCashierOdds) {
      const oddRows = await prisma.odd.findMany({
        where: { match_id: { in: matchIds } },
        select: {
          match_id: true,
          market: true,
          selection: true,
          odds: true,
          status: true,
        },
      });
      for (const row of oddRows) {
        const bucket = oddRowsByMatch.get(row.match_id);
        if (bucket) bucket.push(row);
        else oddRowsByMatch.set(row.match_id, [row]);
      }
    }

    // Product of decimal odds (e.g. 2.0 * 1.5 => 3.0)
    const totalOdds = selections.reduce(
      (sum, item) => sum * Number(item.odds),
      1,
    );
    if (!Number.isFinite(totalOdds) || totalOdds <= 1) {
      return res.status(400).json({ message: "Selections odds are invalid" });
    }

    const legCount = selections.length;
    // Independent config lookups — resolve concurrently rather than serially.
    const [accResolved, limits, winningsTaxSnapshot] = await Promise.all([
      resolveAccumulatorForNewTicket(prisma, legCount, numericStake, totalOdds),
      resolveBettingLimits(prisma),
      snapshotWinningsTaxForNewTicket(prisma),
    ]);
    const potentialWin = capGrossPotentialWin(
      limits,
      accResolved.potential_win,
    );
    const limitMsg = getStakeAndPotentialWinViolation(
      limits,
      numericStake,
      potentialWin,
    );
    if (limitMsg) {
      return res.status(400).json({ message: limitMsg });
    }

    // Pre-validate and normalize every selection so a single bad leg
    // returns a structured 400 with the offending index, instead of
    // throwing inside the Prisma `create` call.
    const validationErrors = [];
    const preparedSelections = selections.map((item, idx) => {
      // Cashier admin-Match path: lenient guard — require a resolvable code with
      // a real grader (checks 1–3), but NOT the feed allowlist, since cashier
      // markets settle via the admin result-string path and shouldn't be
      // over-blocked. Still closes the unresolvable / no-handler holes.
      const support = classifySelectionSupport(
        {
          marketCode: item.marketCode,
          marketLabel: item.marketLabel,
          selection: item.selection,
          label: item.selection,
          marketParams: item.marketParams,
        },
        { mode: "lenient" },
      );
      if (!support.ok) {
        validationErrors.push({
          index: idx,
          code: support.reason || "market_not_supported",
          field: "marketCode",
          marketLabel: item.marketLabel || null,
          label: item.selection || null,
          details: null,
        });
        return null;
      }
      if (verifyCashierOdds) {
        const verdict = verifyCashierSelectionOdds(
          oddRowsByMatch.get(item.matchId),
          item,
        );
        if (!verdict.ok) {
          validationErrors.push({
            index: idx,
            code: verdict.code,
            field: "odds",
            marketLabel: item.marketLabel || null,
            label: item.selection || null,
            details:
              verdict.serverOdds != null
                ? { serverOdds: verdict.serverOdds }
                : null,
          });
          return null;
        }
      }
      return {
        match_id: item.matchId,
        selection: item.selection,
        odds: Number(item.odds),
        market_code: support.code,
        market_params: support.params,
        result: "PENDING",
      };
    });

    if (validationErrors.length) {
      return res.status(400).json({
        message: "Invalid selections",
        errors: validationErrors,
      });
    }

    let couponNumber;
    try {
      const incomingSig = canonicalLegsSignature(
        canonicalRowsFromCashierPrepared(preparedSelections),
      );
      couponNumber = await resolveCouponNumberForCreate(
        prisma,
        rawCoupon,
        incomingSig,
      );
    } catch (e) {
      if (e.code === "COUPON_REUSE_UNKNOWN") {
        return res.status(400).json({
          message:
            "couponNumber does not match any existing ticket; omit it to create a new coupon",
        });
      }
      if (e.code === "COUPON_SELECTIONS_MISMATCH") {
        return res.status(400).json({
          message: "Selections do not match the coupon template",
        });
      }
      throw e;
    }

    const created = await prisma.ticket.create({
      data: {
        coupon_number: couponNumber,
        user_id: userId,
        cashier_id: cashierId,
        branch_name: cashier.branch_name,
        branch_location: cashier.branch_location,
        stake: numericStake,
        total_odds: totalOdds,
        accumulator_bonus_percent: accResolved.accumulator_bonus_percent,
        potential_win: potentialWin,
        status: "OPEN",
        selections: { create: preparedSelections },
        ...winningsTaxSnapshot,
      },
      include: ticketDetailInclude,
    });

    const createdTicket = mapTicket(created);
    await logAuditEvent({
      req,
      action: "TICKET_CREATED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: createdTicket.id,
      before: null,
      after: createdTicket,
    });
    return res.status(201).json(createdTicket);
  } catch (error) {
    // FK violation: bad cashier/user/match id
    if (error?.code === "P2003") {
      return res.status(400).json({
        message: "Invalid userId/cashierId or match relation",
      });
    }

    console.error("createTicket error:", error);
    return res.status(500).json({ message: "Failed to create ticket" });
  }
}

/**
 * Shared prebook selection normalization for /api/bets/validate and /api/bets/place.
 */
function normalizePrebookSelectionsInput(selections = []) {
  const validationErrors = [];
  const normalizedSelections = (Array.isArray(selections) ? selections : [])
    .map((item, idx) => {
      const apiFixtureId = Number.parseInt(item?.apiFixtureId, 10);
      const explicitMarketCode = item?.marketCode
        ? String(item.marketCode).toUpperCase().trim()
        : null;
      const marketLabel = String(item?.marketLabel || "").trim();
      const label = String(item?.label || "").trim();
      let marketCode;
      let marketParams;

      // PHASE-0 PLACEMENT GUARD (engine-independent). A leg may only be stored
      // if it resolves to a real settlement grader, the name↔code mapping is
      // consistent (blocks the mis-mapped markets), and the code is allowlisted
      // for the active phase. This closes the null-`market_code` hole that
      // produced unsettleable + mis-graded tickets.
      const support = classifySelectionSupport(
        { marketCode: explicitMarketCode, marketLabel, selection: label, label, marketParams: item?.marketParams },
        { mode: "strict" },
      );
      if (!support.ok) {
        validationErrors.push({
          index: idx,
          code: support.reason || "market_not_supported",
          field: "marketCode",
          marketLabel,
          label,
          details: null,
        });
        return null;
      }
      marketCode = support.code;
      marketParams = support.params;

      const accepted = Number(item?.acceptedOdds);
      const submitted = Number(item?.odds);
      const effectiveOdds = Number.isFinite(accepted) ? accepted : submitted;
      const acceptedMarketVersion = Number(item?.acceptedMarketVersion);
      const marketVersion = Number(item?.marketVersion);
      const effectiveMarketVersion = Number.isFinite(acceptedMarketVersion)
        ? acceptedMarketVersion
        : Number.isFinite(marketVersion)
          ? marketVersion
          : null;

      return {
        index: idx,
        apiFixtureId: Number.isFinite(apiFixtureId) ? apiFixtureId : null,
        matchName: String(item?.matchName || "").trim(),
        league: String(item?.league || "").trim(),
        marketLabel,
        marketCode,
        marketParams,
        label,
        odds: effectiveOdds,
        marketVersion: effectiveMarketVersion,
        fromLive: Boolean(item?.fromLive),
      };
    })
    .filter(
      (item) =>
        item &&
        item.label &&
        Number.isFinite(item.odds) &&
        (item.fromLive || item.odds > 1),
    );

  return { normalizedSelections, validationErrors };
}

function parseAcceptOddsChanges(value) {
  if (value === true) return true;
  return (
    String(value || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function normalizeIdempotencyKey(req) {
  const raw = req.headers["idempotency-key"];
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
}

async function logValidationFailure({ action, req, code, meta = {} }) {
  try {
    await logAuditEvent({
      action,
      module: "tickets",
      actor_role: req.user?.role || "PUBLIC",
      user_id: req.user?.sub || null,
      details: `Validation rejected with ${code}`,
      meta: { code, ...meta },
    });
    await logPlacementValidation({
      actorUserId: req.user?.sub || null,
      actorRole: req.user?.role || "PUBLIC",
      ticketId: meta.ticketId || null,
      flowChannel: req.user?.role === "CASHIER" ? "CASHIER" : "PLAYER",
      isLive: Boolean(meta.isLive),
      fixtureIds: Array.isArray(meta.fixtureIds) ? meta.fixtureIds : [],
      rejectionReason: code,
      status: "REJECTED",
      payload: meta,
    });
  } catch {
    // non-blocking audit path
  }
}

async function buildValidationFinancials({ selections, stake, totalOdds }) {
  const numericStake = Number(stake);
  if (!Number.isFinite(numericStake) || numericStake <= 0) return null;
  const legCount = selections.length;
  const accResolved = await resolveAccumulatorForNewTicket(
    prisma,
    legCount,
    numericStake,
    totalOdds,
  );
  const limits = await resolveBettingLimits(prisma);
  const potentialWin = capGrossPotentialWin(limits, accResolved.potential_win);
  return {
    stake: numericStake,
    totalOdds,
    potentialWin,
    accumulatorBonusPercent: accResolved.accumulator_bonus_percent,
  };
}

/**
 * POST /api/bets/validate
 * Dry-run validation for sportsbook slip. Does not create a ticket.
 */
export async function validatePrebookTicket(req, res) {
  try {
    const { selections = [], stake } = req.body ?? {};
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        code: "invalid_selections",
        message: "selections[] are required",
      });
    }

    const { normalizedSelections, validationErrors } =
      normalizePrebookSelectionsInput(selections);
    if (validationErrors.length) {
      return res.status(400).json({
        code: "invalid_selections",
        details: validationErrors,
      });
    }
    if (normalizedSelections.length === 0) {
      return res.status(400).json({
        code: "invalid_selections",
        message: "Selections odds are invalid",
      });
    }

    const actorId =
      String(req.user?.sub || "").trim() || `anon:${req.ip || "?"}`;
    const live = normalizedSelections.some((s) => s.fromLive);
    const validated = await validatePlacementSelections({
      prismaClient: prisma,
      rawSelections: normalizedSelections.map((item) => ({
        apiFixtureId: item.apiFixtureId,
        marketLabel: item.marketLabel,
        marketCode: item.marketCode,
        marketParams: item.marketParams,
        label: item.label,
        odds: item.odds,
        marketVersion: item.marketVersion,
      })),
      live,
      actorId,
      writeFreeze: true,
      now: new Date(),
    });

    const financials = await buildValidationFinancials({
      selections: normalizedSelections,
      stake,
      totalOdds: Number(validated.totalOdds || 0),
    });

    if (!validated.ok && validated.code === "odds_changed") {
      return res.status(409).json({
        ok: false,
        code: "odds_changed",
        requiresConfirmation: true,
        message: "Odds changed. Please review and confirm latest odds.",
        selections: validated.drift,
        newTotalOdds: Number(validated.totalOdds || 0),
        newPotentialWin: Number(financials?.potentialWin || 0),
        freezeToken: validated.freezeToken || null,
      });
    }
    if (!validated.ok && validated.code === "market_version_changed") {
      return res.status(409).json({
        ok: false,
        code: "market_version_changed",
        requiresConfirmation: true,
        message:
          "Market version changed. Please review and confirm latest market.",
        selections: validated.versionDrift || [],
        newTotalOdds: Number(validated.totalOdds || 0),
        newPotentialWin: Number(financials?.potentialWin || 0),
        freezeToken: validated.freezeToken || null,
      });
    }
    if (!validated.ok) {
      return res.status(409).json({
        ok: false,
        code: validated.code || "validation_failed",
        selections: validated.selections || [],
      });
    }

    return res.json({
      ok: true,
      totalOdds: Number(validated.totalOdds || 0),
      potentialWin: Number(financials?.potentialWin || 0),
      accumulatorBonusPercent: Number(financials?.accumulatorBonusPercent || 0),
      freezeToken: validated.freezeToken || null,
      selections: (validated.resolved || []).map((row) => ({
        index: row.index,
        serverOdds: Number(row.serverOdds || 0),
        marketState: row.marketState || "OPEN",
        serverMarketVersion: Number(row.serverMarketVersion || 0),
        serverUpdatedAt: row.serverUpdatedAt || null,
      })),
    });
  } catch (error) {
    console.error("validatePrebookTicket error:", error);
    return res
      .status(500)
      .json({ code: "internal_error", message: "Failed to validate bet" });
  }
}

/**
 * POST /api/bets/place
 * Public pre-book flow from frontend sportsbook.
 * Creates an OPEN ticket with no cashier assigned yet; cashier claims it on print confirmation.
 */
export async function createPrebookTicket(req, res) {
  const placeStartedAt = Date.now();
  const authenticatedUserIdEarly = String(req.user?.sub || "").trim() || null;
  try {
    const {
      selections = [],
      stake,
      couponNumber: rawCoupon,
      acceptOddsChanges,
    } = req.body ?? {};
    if (!Array.isArray(selections) || selections.length === 0 || !stake) {
      return res.status(400).json({
        error: "stake and selections[] are required",
      });
    }

    const { normalizedSelections, validationErrors } =
      normalizePrebookSelectionsInput(selections);

    if (validationErrors.length) {
      return res.status(400).json({
        error: "invalid_selections",
        details: validationErrors,
      });
    }
    if (normalizedSelections.length === 0) {
      return res.status(400).json({ error: "Selections odds are invalid" });
    }

    const numericStake = Number(stake);
    if (!Number.isFinite(numericStake) || numericStake <= 0) {
      return res.status(400).json({ error: "Stake must be a positive number" });
    }
    const authenticatedUserId = String(req.user?.sub || "").trim() || null;
    const idempotencyKey = normalizeIdempotencyKey(req);
    if (authenticatedUserId && !idempotencyKey) {
      return res.status(400).json({
        code: "idempotency_required",
        error: "Idempotency-Key header is required",
      });
    }
    const replayKey =
      authenticatedUserId && idempotencyKey
        ? `idem:prebook:${authenticatedUserId}:${idempotencyKey}`
        : null;
    if (replayKey) {
      const replay = await perfSpan(req.id, "place.idempotencyReplay", () =>
        getCache(replayKey),
      );
      if (replay && replay.payload) {
        return res.status(200).json({
          ...replay.payload,
          replayed: true,
        });
      }
    }

    if (idempotencyKey) {
      const existingTicket = await perfSpan(req.id, "place.idempotencyLookup", () =>
        prisma.ticket.findFirst({
          where: { idempotency_key: idempotencyKey },
          select: {
            id: true,
            coupon_number: true,
            receipt_number: true,
            total_odds: true,
            stake: true,
            potential_win: true,
            status: true,
          },
        }),
      );
      if (existingTicket) {
        return res.status(409).json({
          code: "idempotency_conflict",
          error: "Request was already processed",
          ticketId: existingTicket.id,
          couponNumber: existingTicket.coupon_number,
          receiptNumber: existingTicket.receipt_number,
          totalOdds: existingTicket.total_odds,
          stake: existingTicket.stake,
          potentialWin: existingTicket.potential_win,
          status: existingTicket.status,
        });
      }
    }

    const actorId =
      String(req.user?.sub || "").trim() || `anon:${req.ip || "?"}`;
    const live = normalizedSelections.some((s) => s.fromLive);
    const validated = await perfSpan(req.id, "place.validateSelections", () =>
      validatePlacementSelections({
        prismaClient: prisma,
        rawSelections: normalizedSelections.map((item) => ({
          apiFixtureId: item.apiFixtureId,
          marketLabel: item.marketLabel,
          marketCode: item.marketCode,
          marketParams: item.marketParams,
          label: item.label,
          odds: item.odds,
          marketVersion: item.marketVersion,
        })),
        live,
        actorId,
        writeFreeze: false,
        now: new Date(),
      }),
    );

    const acceptedChanges = parseAcceptOddsChanges(acceptOddsChanges);
    if (!validated.ok && validated.code === "odds_changed") {
      await logValidationFailure({
        action: "TICKET_PLACE_ODDS_CHANGED",
        req,
        code: "odds_changed",
        meta: { selections: validated.drift },
      });
      return res.status(409).json({
        code: "odds_changed",
        requiresConfirmation: true,
        message: "Odds changed. Please review and confirm latest odds.",
        selections: validated.drift,
        newTotalOdds: Number(validated.totalOdds || 0),
      });
    }
    if (!validated.ok && validated.code === "market_version_changed") {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: "market_version_changed",
        meta: { selections: validated.versionDrift || [] },
      });
      return res.status(409).json({
        code: "market_version_changed",
        requiresConfirmation: true,
        message: "Market version changed. Please confirm latest market.",
        selections: validated.versionDrift || [],
        newTotalOdds: Number(validated.totalOdds || 0),
      });
    }
    if (!validated.ok && validated.code === "market_locked") {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: "market_locked",
      });
      return res.status(409).json({
        code: "market_locked",
        selections: validated.selections || [],
      });
    }
    if (!validated.ok && validated.code === "market_suspended") {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: "market_suspended",
      });
      return res.status(409).json({
        code: "market_suspended",
        selections: validated.selections || [],
      });
    }
    if (!validated.ok && validated.code === "fixture_started") {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: "fixture_started",
      });
      return res.status(409).json({
        code: "fixture_started",
        selections: validated.selections || [],
      });
    }
    if (!validated.ok) {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: validated.code || "validation_failed",
      });
      return res.status(400).json({
        code: validated.code || "validation_failed",
      });
    }

    // Explicit confirmation is required whenever the client is placing
    // after a previous odds_changed response. Clients should set
    // acceptOddsChanges=true on confirmed re-submit.
    if (
      !acceptedChanges &&
      String(req.body?.confirmed || "").trim() === "true"
    ) {
      return res.status(400).json({
        code: "confirmation_required",
        message: "Use acceptOddsChanges=true when confirming changed odds",
      });
    }

    const resolvedByIndex = new Map(
      (validated.resolved || []).map((row) => [row.index, row]),
    );
    const lockedSelections = normalizedSelections.map((item) => {
      const row = resolvedByIndex.get(item.index);
      return {
        ...item,
        odds: Number(row?.serverOdds ?? item.odds),
        fixtureId: row?.fixtureId || null,
        kickoffAt: toIsoOrNull(row?.kickoffAt),
        serverMarketVersion: Number(
          row?.serverMarketVersion ?? item.marketVersion ?? 0,
        ),
        marketState: row?.marketState || "OPEN",
        serverUpdatedAt: row?.serverUpdatedAt || null,
        serverLive: Boolean(row?.serverLive),
      };
    });
    const totalOdds = Number(validated.totalOdds || 0);
    const legCount = normalizedSelections.length;
    const [accResolved, limits, winningsTaxSnapshot] = await perfSpan(
      req.id,
      "place.configLookups",
      () =>
        Promise.all([
          resolveAccumulatorForNewTicket(prisma, legCount, numericStake, totalOdds),
          resolveBettingLimits(prisma),
          snapshotWinningsTaxForNewTicket(prisma),
        ]),
    );
    const potentialWin = capGrossPotentialWin(
      limits,
      accResolved.potential_win,
    );
    const limitMsg = getStakeAndPotentialWinViolation(
      limits,
      numericStake,
      potentialWin,
    );
    if (limitMsg) {
      return res.status(400).json({ error: limitMsg });
    }

    const prebookCashierId = String(
      process.env.PREBOOK_CASHIER_ID || "",
    ).trim();

    const ticketSelectionRows = lockedSelections.map((item) => ({
      fixture_id: item.fixtureId || null,
      selection: item.label,
      market_code: item.marketCode || null,
      market_params: item.marketParams ?? undefined,
      odds: item.odds,
      server_odds: item.odds,
      server_odds_at: item.serverUpdatedAt
        ? new Date(item.serverUpdatedAt)
        : new Date(),
      market_state: item.marketState || "OPEN",
      market_version: Number.isFinite(Number(item.marketVersion))
        ? Number(item.marketVersion)
        : null,
      server_market_version: Number.isFinite(Number(item.serverMarketVersion))
        ? Number(item.serverMarketVersion)
        : null,
      live_at_placement: Boolean(item.serverLive),
      result: "PENDING",
    }));

    const serverLive = lockedSelections.some((s) => s.serverLive);
    if (
      serverLive &&
      !authenticatedUserId &&
      String(process.env.ALLOW_ANON_LIVE_COUPONS || "").toLowerCase() !== "true"
    ) {
      await logValidationFailure({
        action: "TICKET_PLACE_VALIDATION_FAILED",
        req,
        code: "anon_live_not_allowed",
        meta: { stage: "placement" },
      });
      return res.status(403).json({
        code: "anon_live_not_allowed",
        message:
          "Live bets require a logged-in account. Log in (or register) to place live bets.",
      });
    }

    const wantHold =
      serverLive &&
      Boolean(authenticatedUserId) &&
      LIVE_ACCEPTANCE_DELAY_MS > 0;
    const holdSlotAvailable =
      LIVE_HOLD_MAX_CONCURRENT === 0
        ? false
        : liveHoldsInFlight < LIVE_HOLD_MAX_CONCURRENT;
    const useHold = wantHold && holdSlotAvailable;
    if (wantHold && !useHold) {
      if (LIVE_HOLD_FAIL_CLOSED && LIVE_HOLD_MAX_CONCURRENT > 0) {
        console.warn(
          `[createPrebookTicket] live hold cap reached (${liveHoldsInFlight}/${LIVE_HOLD_MAX_CONCURRENT}) — rejecting live bet (fail-closed)`,
        );
        return res.status(503).json({
          code: "live_busy",
          message:
            "Live betting is very busy right now. Please try again in a few seconds.",
          retryable: true,
        });
      }
      console.warn(
        `[createPrebookTicket] live hold cap reached (${liveHoldsInFlight}/${LIVE_HOLD_MAX_CONCURRENT}) — accepting instantly without hold`,
      );
    }

    const ticketDataBase = {
      user_id: authenticatedUserId,
      branch_name: "",
      branch_location: "",
      stake: numericStake,
      total_odds: totalOdds,
      accumulator_bonus_percent: accResolved.accumulator_bonus_percent,
      potential_win: potentialWin,
      status: useHold ? "HELD" : "OPEN",
      selection_snapshot: lockedSelections,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      channel: serverLive ? "LIVE" : "PREMATCH",
      validation_meta: {
        code: validated.code,
        totalOdds: Number(validated.totalOdds || 0),
      },
      ...winningsTaxSnapshot,
    };

    let couponNumber;
    try {
      const incomingSig = canonicalLegsSignature(
        canonicalRowsFromPrebook(lockedSelections),
      );
      couponNumber = await perfSpan(req.id, "place.couponResolve", () =>
        resolveCouponNumberForCreate(prisma, rawCoupon, incomingSig),
      );
    } catch (e) {
      if (e.code === "COUPON_REUSE_UNKNOWN") {
        return res.status(400).json({
          error:
            "couponNumber does not match any existing ticket; omit it to create a new coupon",
        });
      }
      if (e.code === "COUPON_SELECTIONS_MISMATCH") {
        return res.status(400).json({
          error: "Selections do not match the coupon template",
        });
      }
      throw e;
    }

    let created;
    if (authenticatedUserId) {
      const playerWallet = await perfSpan(req.id, "place.walletLookup", () =>
        prisma.wallet.findFirst({
          where: { user_id: authenticatedUserId, wallet_type: "PLAYER" },
          select: { id: true },
        }),
      );
      if (!playerWallet) throw new Error("PLAYER_WALLET_NOT_FOUND");
      const result = await perfSpan(req.id, "place.walletTicketCreate", () =>
        withWalletLock(playerWallet.id, {}, async () =>
        prisma.$transaction(async (tx) => {
          const receiptNumber = await reserveUniqueReceiptNumber(tx);

          const wallet = await tx.wallet.findFirst({
            where: { user_id: authenticatedUserId, wallet_type: "PLAYER" },
          });
          if (!wallet) throw new Error("PLAYER_WALLET_NOT_FOUND");

          const debited = await debitWallet(tx, wallet, numericStake, {
            fromWithdrawable: false,
          });
          await tx.transaction.create({
            data: {
              wallet_id: wallet.id,
              type: "BET",
              amount: numericStake,
              balance_before: debited.balanceBefore,
              balance_after: debited.balanceAfter,
              reference: idempotencyKey
                ? `idem:${authenticatedUserId}:${idempotencyKey}`
                : `ticket:${receiptNumber}`,
            },
          });

          const data = {
            ...ticketDataBase,
            coupon_number: couponNumber,
            receipt_number: receiptNumber,
          };
          if (ticketSelectionRows.length > 0) {
            data.selections = { create: ticketSelectionRows };
          }
          if (prebookCashierId) {
            data.cashier = { connect: { id: prebookCashierId } };
          }

          const ticket = await tx.ticket.create({ data });
          return { ticket, balanceAfter: debited.balanceAfter };
        }),
        ),
      );
      created = result.ticket;
    } else {
      const data = {
        ...ticketDataBase,
        coupon_number: couponNumber,
      };
      if (ticketSelectionRows.length > 0) {
        data.selections = { create: ticketSelectionRows };
      }
      if (prebookCashierId) {
        data.cashier = { connect: { id: prebookCashierId } };
      }
      created = await perfSpan(req.id, "place.anonTicketCreate", () =>
        prisma.ticket.create({ data }),
      );
    }

    if (useHold) {
      liveHoldsInFlight += 1;
      try {
        await sleep(LIVE_ACCEPTANCE_DELAY_MS);
        const recheck = await validatePlacementSelections({
          prismaClient: prisma,
          rawSelections: lockedSelections.map((item) => ({
            apiFixtureId: item.apiFixtureId,
            marketLabel: item.marketLabel,
            marketCode: item.marketCode,
            marketParams: item.marketParams,
            label: item.label,
            odds: item.odds,
            marketVersion: item.serverMarketVersion,
          })),
          live: true,
          actorId,
          writeFreeze: false,
          now: new Date(),
        });

        if (!recheck.ok) {
          const code = recheck.code || "market_suspended";
          try {
            await refundHeldTicket(created.id);
          } catch (refundErr) {
            console.error(
              `[createPrebookTicket] hold refund failed for ${created.id}:`,
              refundErr?.message || refundErr,
            );
          }
          await logValidationFailure({
            action: "TICKET_PLACE_VALIDATION_FAILED",
            req,
            code,
            meta: { stage: "acceptance_delay" },
          });
          await logPlacementValidation({
            actorUserId: authenticatedUserId,
            actorRole: req.user?.role || "PLAYER",
            ticketId: created.id,
            idempotencyKey,
            flowChannel: "LIVE",
            isLive: true,
            fixtureIds: lockedSelections
              .map((row) => row.apiFixtureId)
              .filter(Number.isFinite),
            rejectionReason: `held_${code}`,
            status: "REJECTED",
          });
          return res.status(409).json({
            code,
            message: "Bet rejected after the live acceptance check; stake refunded.",
            selections: recheck.selections || [],
            heldRejected: true,
          });
        }

        const committed = await commitHeldTicket(created.id);
        if (!committed) {
          const fin = await prisma.ticket.findUnique({
            where: { id: created.id },
            select: { status: true },
          });
          return res.status(409).json({
            code: "bet_rejected",
            message: "Bet could not be confirmed; stake refunded.",
            status: fin?.status || "CANCELED",
            heldRejected: true,
          });
        }
        created = { ...created, status: "OPEN" };
      } finally {
        liveHoldsInFlight -= 1;
      }
    }

    if (authenticatedUserId) {
      const msg = betPlacedNotification({
        stake: created.stake,
        receiptNumber: created.receipt_number,
        potentialWin: created.potential_win,
      });
      void notifyUserSafe({
        userId: authenticatedUserId,
        ...msg,
      });
    }

    const payload = {
      ticketId: created.id,
      couponNumber: created.coupon_number,
      receiptNumber: created.receipt_number ?? null,
      totalOdds: created.total_odds,
      stake: created.stake,
      potentialWin: created.potential_win,
      status: created.status,
    };
    await perfSpan(req.id, "place.logValidation", () =>
      logPlacementValidation({
      actorUserId: authenticatedUserId || null,
      actorRole: req.user?.role || (authenticatedUserId ? "PLAYER" : "PUBLIC"),
      ticketId: created.id,
      idempotencyKey,
      flowChannel: serverLive ? "LIVE" : "PREMATCH",
      isLive: serverLive,
      fixtureIds: lockedSelections
        .map((row) => row.apiFixtureId)
        .filter(Number.isFinite),
      submittedOdds: normalizedSelections.map((row) => row.odds),
      serverOdds: lockedSelections.map((row) => row.odds),
      submittedMarketVersions: normalizedSelections.map(
        (row) => row.marketVersion,
      ),
      serverMarketVersions: lockedSelections.map(
        (row) => row.serverMarketVersion,
      ),
      marketStates: lockedSelections.map((row) => row.marketState),
      rejectionReason: null,
      status: "SUCCESS",
      payload: { totalOdds, potentialWin },
    }),
    );
    if (replayKey) {
      await perfSpan(req.id, "place.idempotencyCache", () =>
        setCache(replayKey, { payload }, 600),
      );
    }
    return res.status(201).json(payload);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        code: "idempotency_conflict",
        error: "Request was already processed",
      });
    }
    if (error?.code === "wallet_busy" || error?.message === "WALLET_BUSY") {
      await logPlacementValidation({
        actorUserId: req.user?.sub || null,
        actorRole: req.user?.role || "PLAYER",
        flowChannel: "PLAYER",
        rejectionReason: "wallet_busy",
        status: "REJECTED",
      });
      return res.status(409).json({
        code: "wallet_busy",
        message: "Wallet is processing another request. Retry shortly.",
      });
    }
    if (error?.message === "PLAYER_WALLET_NOT_FOUND") {
      return res.status(404).json({ error: "Player wallet not found" });
    }
    if (error?.message === "INSUFFICIENT_BALANCE") {
      await logPlacementValidation({
        actorUserId: req.user?.sub || null,
        actorRole: req.user?.role || "PLAYER",
        flowChannel: "PLAYER",
        rejectionReason: "insufficient_balance",
        status: "REJECTED",
      });
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }
    console.error("createPrebookTicket error:", error);
    return res.status(500).json({ error: "Failed to place bet" });
  } finally {
    const elapsed = Date.now() - placeStartedAt;
    if (elapsed >= slowThresholdMs()) {
      console.warn(
        `[place-bet:slow] ${elapsed}ms user=${authenticatedUserIdEarly || "anon"} legs=${Number(req.body?.selections?.length || 0)} requestId=${req.id || "n/a"}`,
      );
    }
  }
}

/**
 * GET /api/tickets
 * Query filters: couponNumber, receiptId (ticket id), status, cashierId,
 * branchName, branchLocation, date (YYYY-MM-DD), page, limit.
 * date + PAID/CASHBACK_PAID filters by paid_at; other statuses use created_at.
 */
export async function listTickets(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const couponNumber = String(req.query.couponNumber || "").trim();
    const receiptNumber = String(req.query.receiptNumber || "").trim();
    const receiptId = String(req.query.receiptId || "").trim();
    const status = String(req.query.status || "").trim();
    const cashierId = String(req.query.cashierId || "").trim();
    const branchName = String(req.query.branchName || "").trim();
    const branchLocation = String(req.query.branchLocation || "").trim();
    const date = String(req.query.date || "").trim();

    const where = {};
    let resolvedCashierId = "";
    let loggedInCashierId = "";

    // Agents can only see tickets from cashiers they are assigned to
    if (req.user.role === "AGENT") {
      const agentCashiers = await prisma.agentCashier.findMany({
        where: { agent_id: req.user.sub },
        select: { cashier_id: true },
      });
      const allowedCashierIds = agentCashiers.map((ac) => ac.cashier_id);
      where.cashier_id = { in: allowedCashierIds };
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      resolvedCashierId = cashier.id;
      loggedInCashierId = cashier.id;
    }

    if (couponNumber) {
      where.coupon_number = { contains: couponNumber, mode: "insensitive" };
    }

    if (receiptNumber) {
      where.receipt_number = normalizeReceiptLookupInput(receiptNumber);
    }

    if (receiptId) {
      where.id = { contains: receiptId, mode: "insensitive" };
    }

    if (status) {
      where.status = status;
    }

    if (cashierId && req.user.role !== "CASHIER") {
      where.cashier_id = cashierId;
      resolvedCashierId = cashierId;
    }

    // Cashier view:
    // - normal lists: only own sold tickets
    // - coupon lookup: own sold tickets + unclaimed prebook tickets
    if (req.user.role === "CASHIER") {
      if (couponNumber) {
        where.OR = [
          { cashier_id: loggedInCashierId },
          { cashier_id: null },
          { cashier_id: { isSet: false } },
        ];
      } else {
        where.cashier_id = loggedInCashierId;
      }
    }

    if (branchName) {
      where.branch_name = { contains: branchName, mode: "insensitive" };
    }
    if (branchLocation) {
      where.branch_location = { contains: branchLocation, mode: "insensitive" };
    }

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date filter" });
      }
      const dateField = ticketListDateField(status);
      where[dateField] = { gte: start, lte: end };
    }

    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: ticketListOrderBy(status),
        skip,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ]);

    if (resolvedCashierId && items.length > 0) {
      const printed = await getPrintedTicketIdSet({
        cashierId: resolvedCashierId,
        ticketIds: items.map((item) => item.id),
      });
      items.forEach((item) => {
        item.printed = printed.has(item.id);
      });
    }

    return res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listTickets error:", error);
    return res.status(500).json({ message: "Failed to list tickets" });
  }
}

/** GET /api/tickets/:id — full ticket with selections and match rows */
export async function getTicketById(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (req.user.role === "AGENT") {
      if (!ticket.cashier_id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allowed = await prisma.agentCashier.findFirst({
        where: { agent_id: req.user.sub, cashier_id: ticket.cashier_id },
        select: { id: true },
      });
      if (!allowed) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const printed = ticket.cashier_id
      ? await getPrintedTicketIdSet({
          cashierId: ticket.cashier_id,
          ticketIds: [ticket.id],
        })
      : new Set();
    return res.json(mapTicket(ticket, { printed: printed.has(ticket.id) }));
  } catch (error) {
    console.error("getTicketById error:", error);
    return res.status(500).json({ message: "Failed to get ticket" });
  }
}

/** GET /api/tickets/by-receipt?receiptNumber= — same access rules as getTicketById */
export async function getTicketByReceipt(req, res) {
  try {
    const compact = normalizeReceiptLookupInput(
      req.query.receiptNumber ?? req.query.receipt ?? "",
    );
    if (!compact) {
      return res.status(400).json({ message: "receiptNumber is required" });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { receipt_number: compact },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (req.user.role === "AGENT") {
      if (!ticket.cashier_id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allowed = await prisma.agentCashier.findFirst({
        where: { agent_id: req.user.sub, cashier_id: ticket.cashier_id },
        select: { id: true },
      });
      if (!allowed) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const printed = ticket.cashier_id
      ? await getPrintedTicketIdSet({
          cashierId: ticket.cashier_id,
          ticketIds: [ticket.id],
        })
      : new Set();
    return res.json(mapTicket(ticket, { printed: printed.has(ticket.id) }));
  } catch (error) {
    console.error("getTicketByReceipt error:", error);
    return res.status(500).json({ message: "Failed to get ticket" });
  }
}

/**
 * GET /api/tickets/by-coupon?couponNumber=...&status=...
 * Single-call coupon lookup for cashier/agent flows — returns full ticket detail
 * for the most recent ticket matching the coupon (repeat flow can share a coupon,
 * so this mirrors the list endpoint's "first" pick: order by created_at desc).
 */
export async function getTicketByCoupon(req, res) {
  try {
    const { compact, compactLower } = normalizeCouponLookupInput(
      req.query.couponNumber ?? req.query.coupon ?? "",
    );
    if (!compactLower) {
      return res.status(400).json({ message: "couponNumber is required" });
    }

    const candidates = couponLookupCandidates(compact, compactLower);
    const where = { coupon_number: { in: candidates } };
    const status = String(req.query.status || "").trim().toUpperCase();
    if (status) where.status = status;

    const ticket = await prisma.ticket.findFirst({
      where,
      include: ticketDetailInclude,
      orderBy: { created_at: "desc" },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (req.user.role === "AGENT") {
      if (!ticket.cashier_id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allowed = await prisma.agentCashier.findFirst({
        where: { agent_id: req.user.sub, cashier_id: ticket.cashier_id },
        select: { id: true },
      });
      if (!allowed) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const printed = ticket.cashier_id
      ? await getPrintedTicketIdSet({
          cashierId: ticket.cashier_id,
          ticketIds: [ticket.id],
        })
      : new Set();
    return res.json(mapTicket(ticket, { printed: printed.has(ticket.id) }));
  } catch (error) {
    console.error("getTicketByCoupon error:", error);
    return res.status(500).json({ message: "Failed to get ticket" });
  }
}

/**
 * GET /api/tickets/:id/sell-blocking
 * Lists all legs that block sell/print (started fixture, locked market, etc.).
 */
export async function getTicketSellBlocking(req, res) {
  try {
    const check = await assertOpenTicketEditable(req, req.params.id, {
      includeSelections: true,
    });
    if (check.error) {
      return res.status(check.error.status).json({ message: check.error.message });
    }

    const { blockingLegs } = await collectSellBlockingLegs({
      prismaClient: prisma,
      ticket: check.ticket,
    });

    return res.json({
      blockingLegs,
      hasBlockingLegs: blockingLegs.length > 0,
    });
  } catch (error) {
    console.error("getTicketSellBlocking error:", error);
    return res.status(500).json({ message: "Failed to load sell blocking state" });
  }
}

/**
 * PATCH /api/tickets/:id/cancel
 * Sets status CANCELED if OPEN or PRINTED (sold), within cancel window, and all match start_times are in the future.
 */
export async function cancelTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (!ticket.cashier_id) {
        return res.status(403).json({ message: "Ticket is not sold yet" });
      }
      if (ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (ticket.status !== "OPEN" && ticket.status !== "PRINTED") {
      return res.status(400).json({
        message: "Only OPEN or PRINTED (sold) tickets can be canceled",
      });
    }

    const now = new Date();
    const cancelWindowMinutes = await resolveCancelWindowMinutes(prisma);
    const windowEndsAt = new Date(
      ticket.created_at.getTime() + cancelWindowMinutes * 60 * 1000,
    );

    // Window length comes from admin `Setting` (see settingsController)
    if (now > windowEndsAt) {
      return res.status(400).json({
        message: "Ticket cancellation window has passed",
      });
    }

    const anyStarted = ticket.selections.some((selection) => {
      const kickoff = selectionKickoffTime(selection);
      if (!kickoff) return false;
      return kickoff <= now;
    });

    if (anyStarted) {
      return res.status(400).json({
        message: "Cannot cancel ticket because at least one match has started",
      });
    }

    let refunds = [];
    try {
      refunds = await prisma.$transaction(async (tx) => {
        const refundRows = await refundTicketStakeInTx(tx, ticket);
        const { count } = await tx.ticket.updateMany({
          where: { id: ticket.id, status: { in: ["OPEN", "PRINTED"] } },
          data: { status: "CANCELED" },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }
        return refundRows;
      });
    } catch (txErr) {
      if (txErr?.statusCode === 409) {
        return res.status(409).json({
          message: "Ticket status changed concurrently; cancel rejected",
          code: "status_conflict",
        });
      }
      throw txErr;
    }

    await logAuditEvent({
      req,
      action: "TICKET_CANCELED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: "CANCELED" },
      meta: refunds.length > 0 ? { refunds } : undefined,
    });

    return res.json({
      message: "Ticket canceled successfully",
      ticket: { ...ticket, status: "CANCELED" },
      ...(refunds.length > 0 ? { refunds } : {}),
    });
  } catch (error) {
    console.error("cancelTicket error:", error);
    return res.status(500).json({ message: "Failed to cancel ticket" });
  }
}

/**
 * PATCH /api/tickets/:id/void
 * Admin void — only OPEN or PRINTED tickets can be voided.
 * If the ticket was printed (cashier wallet debited), the stake is
 * refunded to the cashier wallet atomically.
 */
const VOIDABLE_STATUSES = new Set(["OPEN", "PRINTED"]);

export async function voidTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (!VOIDABLE_STATUSES.has(ticket.status)) {
      return res
        .status(400)
        .json({ message: `Cannot void a ${ticket.status} ticket` });
    }

    const printTx = await prisma.transaction.findFirst({
      where: { type: "BET", reference: `ticket-print:${ticket.id}` },
      select: { id: true, wallet_id: true, amount: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, status: { in: [...VOIDABLE_STATUSES] } },
        data: { status: "VOID" },
      });
      if (count === 0) {
        throw Object.assign(new Error("STATUS_CONFLICT"), {
          statusCode: 409,
        });
      }

      let refundResult = null;
      if (printTx?.wallet_id) {
        const voidRefundRef = `void-refund:${ticket.id}`;
        const existingRefund = await tx.transaction.findFirst({
          where: { reference: voidRefundRef },
          select: { id: true },
        });
        if (!existingRefund) {
          const wallet = await tx.wallet.findUnique({
            where: { id: printTx.wallet_id },
          });
          if (wallet) {
            const amount =
              Number(printTx.amount) || Number(ticket.stake) || 0;
            if (amount > 0) {
              const balanceBefore = Number(wallet.balance) || 0;
              const balanceAfter = balanceBefore + amount;
              await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: balanceAfter },
              });
              await tx.transaction.create({
                data: {
                  wallet_id: wallet.id,
                  type: "DEPOSIT",
                  amount,
                  balance_before: balanceBefore,
                  balance_after: balanceAfter,
                  reference: voidRefundRef,
                },
              });
              refundResult = { amount, walletId: wallet.id, balanceAfter };
            }
          }
        }
      }

      return { refundResult };
    });

    await logAuditEvent({
      req,
      action: "TICKET_VOIDED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: "VOID" },
      meta: result.refundResult
        ? { cashierRefund: result.refundResult }
        : undefined,
    });

    return res.json({
      message: "Ticket voided successfully",
      ticket: { ...ticket, status: "VOID" },
    });
  } catch (error) {
    if (error?.statusCode === 409) {
      return res
        .status(409)
        .json({ message: "Ticket status changed concurrently" });
    }
    console.error("voidTicket error:", error);
    return res.status(500).json({ message: "Failed to void ticket" });
  }
}

/**
 * PATCH /api/tickets/:id/payout
 * Body: { cashierId } — must equal ticket.cashier_id (payout only at selling cashier).
 * Credits cashier wallet, records PAYOUT transaction, sets ticket PAID.
 */
export async function payoutTicket(req, res) {
  try {
    const { cashierId } = req.body ?? {};
    let effectiveCashierId = cashierId;

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      effectiveCashierId = cashier.id;
    } else if (!effectiveCashierId) {
      return res.status(400).json({ message: "cashierId is required" });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "WON") {
      return res.status(400).json({
        message: "Only WON tickets can be paid out",
      });
    }

    if (ticket.cashier_id !== effectiveCashierId) {
      return res.status(403).json({
        message: "Payout rejected: ticket must be paid by the selling cashier",
      });
    }

    if (!ticket.receipt_number) {
      return res.status(400).json({
        message:
          "Ticket has no receipt number; complete pay-in or print before payout",
      });
    }

    const cashier = await prisma.cashier.findUnique({
      where: { id: effectiveCashierId },
    });

    if (!cashier) {
      return res.status(400).json({ message: "Invalid cashierId" });
    }

    // potential_win is gross; pay net after snapshotted tax (if any)
    const payoutAmount = ticketWinningsTaxBreakdown(ticket).netPayout;

    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return res.status(400).json({
        message: "Computed payout amount is not positive",
      });
    }

    const payoutRef = `ticket:${ticket.id}`;
    // Idempotency guard: another request may have paid this ticket
    // between the status check above and the transaction. The
    // `Transaction.reference @unique` constraint converts that race
    // into a P2002 which we translate to a 409 below.
    const alreadyPaid = await prisma.transaction.findFirst({
      where: { reference: payoutRef },
      select: { id: true },
    });
    if (alreadyPaid) {
      return res.status(409).json({
        message: "Ticket has already been paid out",
        code: "already_paid",
      });
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { id: cashier.wallet_id },
        });

        if (!wallet) {
          throw new Error("Cashier wallet not found");
        }

        const balanceBefore = Number(wallet.balance);
        const balanceAfter = balanceBefore + payoutAmount;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });

        await tx.transaction.create({
          data: {
            wallet_id: wallet.id,
            type: "PAYOUT",
            amount: payoutAmount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference: payoutRef,
          },
        });

        const paidAt = new Date();
        const { count } = await tx.ticket.updateMany({
          where: { id: ticket.id, status: "WON" },
          data: { status: "PAID", paid_at: paidAt },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }

        return {
          paidTicket: { ...ticket, status: "PAID", paid_at: paidAt },
          walletBalance: balanceAfter,
        };
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "Ticket has already been paid out",
          code: "already_paid",
        });
      }
      if (err?.statusCode === 409) {
        return res.status(409).json({
          message: "Ticket status changed concurrently; payout rejected",
          code: "status_conflict",
        });
      }
      throw err;
    }
    await logAuditEvent({
      req,
      action: "TICKET_PAID_OUT",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: {
        status: result.paidTicket.status,
        cashierWalletBalance: result.walletBalance,
      },
      meta: { cashierId: effectiveCashierId },
    });

    return res.json({
      message: "Ticket paid successfully",
      ticket: result.paidTicket,
      cashierWalletBalance: result.walletBalance,
    });
  } catch (error) {
    console.error("payoutTicket error:", error);
    return res.status(500).json({ message: "Failed to payout ticket" });
  }
}

/**
 * PATCH /api/tickets/:id/stake
 * Body: { stake: number }
 * Updates ticket stake and recomputes potential_win.
 * Only allowed while ticket is OPEN and has not been print-confirmed yet.
 */
export async function updateTicketStake(req, res) {
  try {
    const { stake } = req.body ?? {};
    const numericStake = Number(stake);
    if (!Number.isFinite(numericStake) || numericStake <= 0) {
      return res
        .status(400)
        .json({ message: "stake must be a positive number" });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can have stake updated",
      });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    // Don't allow stake edits after cashier wallet has already been debited
    const printReference = `ticket-print:${ticket.id}`;
    const existingPrint = await prisma.transaction.findFirst({
      where: { type: "BET", reference: printReference },
      select: { id: true },
    });
    if (existingPrint) {
      return res.status(400).json({
        message: "Stake cannot be changed after the ticket has been printed",
      });
    }

    const totalOdds = Number(ticket.total_odds);
    const accPct = Number(ticket.accumulator_bonus_percent) || 0;

    const limits = await resolveBettingLimits(prisma);
    const potentialWin = capGrossPotentialWin(
      limits,
      Number((numericStake * totalOdds * (1 + accPct / 100)).toFixed(2)),
    );
    const limitMsg = getStakeAndPotentialWinViolation(
      limits,
      numericStake,
      potentialWin,
    );
    if (limitMsg) {
      return res.status(400).json({ message: limitMsg });
    }

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        stake: numericStake,
        potential_win: potentialWin,
      },
      include: ticketDetailInclude,
    });

    await logAuditEvent({
      req,
      action: "TICKET_STAKE_UPDATED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: {
        stake: Number(ticket.stake),
        potentialWin: Number(ticket.potential_win),
      },
      after: { stake: numericStake, potentialWin },
    });

    return res.json(mapTicket(updated));
  } catch (error) {
    console.error("updateTicketStake error:", error);
    return res.status(500).json({ message: "Failed to update ticket stake" });
  }
}

async function mappedTicketForPrint(ticketId) {
  const preparedTicket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: ticketDetailInclude,
  });
  const printedSet = preparedTicket?.cashier_id
    ? await getPrintedTicketIdSet({
        cashierId: preparedTicket.cashier_id,
        ticketIds: [ticketId],
      })
    : new Set();
  return preparedTicket
    ? mapTicket(preparedTicket, { printed: printedSet.has(ticketId) })
    : undefined;
}

/**
 * Persist accepted live odds/version onto the ticket so thermal print and
 * confirm-print use the same values the cashier just accepted.
 */
async function applyAcceptedPrintOdds(ticket, validated) {
  if (!ticket || !validated) return;
  const snapshotSelections = Array.isArray(ticket.selection_snapshot)
    ? ticket.selection_snapshot
    : [];
  const resolvedByIndex = new Map(
    (validated.resolved || []).map((row) => [row.index, row]),
  );
  const nextSnapshot = snapshotSelections.map((entry, index) => {
    const row = resolvedByIndex.get(index);
    return row && Number.isFinite(row.serverOdds)
      ? {
          ...entry,
          odds: Number(row.serverOdds),
          serverMarketVersion: Number(row.serverMarketVersion || 0),
          marketState: row.marketState || "OPEN",
        }
      : entry;
  });
  const limits = await resolveBettingLimits(prisma);
  const accPct = Number(ticket.accumulator_bonus_percent) || 0;
  const nextTotalOdds = Number(validated.totalOdds || ticket.total_odds || 0);
  const nextPotentialWin = capGrossPotentialWin(
    limits,
    Number(
      (
        Number(ticket.stake) *
        nextTotalOdds *
        (1 + accPct / 100)
      ).toFixed(2),
    ),
  );
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      total_odds: nextTotalOdds,
      potential_win: nextPotentialWin,
      selection_snapshot: nextSnapshot,
    },
  });
  for (let index = 0; index < (ticket.selections || []).length; index++) {
    const row = ticket.selections[index];
    const resolved = resolvedByIndex.get(index);
    if (!resolved || !Number.isFinite(resolved.serverOdds)) continue;
    await prisma.ticketSelection.update({
      where: { id: row.id },
      data: {
        odds: Number(resolved.serverOdds),
        server_odds: Number(resolved.serverOdds),
        server_odds_at: new Date(),
        market_state: resolved.marketState || "OPEN",
        server_market_version: Number(resolved.serverMarketVersion || 0),
      },
    });
  }
}

async function respondPrintWalletError(req, res, error) {
  if (error?.code === "wallet_busy" || error?.message === "WALLET_BUSY") {
    await logPlacementValidation({
      actorUserId: req.user?.sub || null,
      actorRole: req.user?.role || "CASHIER",
      flowChannel: "CASHIER",
      rejectionReason: "wallet_busy",
      status: "REJECTED",
    });
    return res.status(409).json({
      code: "wallet_busy",
      message: "Cashier wallet is busy. Retry shortly.",
    });
  }
  if (error?.message === "INSUFFICIENT_BALANCE") {
    await logPlacementValidation({
      actorUserId: req.user?.sub || null,
      actorRole: req.user?.role || "CASHIER",
      flowChannel: "CASHIER",
      rejectionReason: "insufficient_balance",
      status: "REJECTED",
    });
    return res.status(400).json({ message: "Insufficient cashier balance" });
  }
  if (error?.message === "INVALID_AMOUNT") {
    return res.status(400).json({ message: "stake must be a positive number" });
  }
  if (error?.message === "ACCESS_DENIED" || error?.statusCode === 403) {
    return res.status(403).json({ message: "Access denied" });
  }
  if (error?.message === "CASHIER_WALLET_NOT_FOUND") {
    return res.status(404).json({ message: "Cashier wallet not found" });
  }
  if (error?.statusCode === 409) {
    return res.status(409).json({
      message: "Ticket status changed concurrently; print rejected",
      code: "status_conflict",
    });
  }
  return null;
}

/**
 * POST /api/tickets/:id/prepare-print
 * Validates odds/markets, holds cashier float (`ticket-print:{id}` BET), and
 * reserves a receipt number before physical print.
 */
export async function preparePrintTicket(req, res) {
  try {
    const requestBody = req.body ?? {};
    const acceptOddsChanges = parseAcceptOddsChanges(
      requestBody.acceptOddsChanges,
    );
    const ticket = await perfSpan(req.id, "print.prepare.loadTicket", () =>
      prisma.ticket.findUnique({
        where: { id: req.params.id },
        include: { selections: true },
      }),
    );
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const cashier = await perfSpan(req.id, "print.prepare.resolveCashier", () =>
      resolveCashierByUserId(req.user.sub),
    );
    if (!cashier) {
      return res.status(404).json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
    }
    if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can be prepared for print",
      });
    }

    const validation = await perfSpan(req.id, "print.prepare.oddsValidation", () =>
      validateOpenTicketForPrint({
        prismaClient: prisma,
        ticket,
        cashierId: cashier.id,
        requestBody,
        acceptOddsChanges,
      }),
    );
    if (!validation.ok) {
      await logValidationFailure({
        action: "TICKET_PREPARE_PRINT_VALIDATION_FAILED",
        req,
        code: validation.logCode,
        meta: validation.logMeta || {},
      });
      return res.status(validation.statusCode).json(validation.body);
    }

    if (acceptOddsChanges && validation.validated) {
      await applyAcceptedPrintOdds(ticket, validation.validated);
    }

    const hold = await perfSpan(req.id, "print.prepare.holdFloat", () =>
      withWalletLock(cashier.wallet_id, {}, async () =>
        prisma.$transaction(async (tx) =>
          holdCashierPrintInTx(tx, {
            ticket,
            cashier,
            reserveReceiptNumber: reserveUniqueReceiptNumber,
          }),
        ),
      ),
    );

    const mapped = await perfSpan(req.id, "print.prepare.reloadTicket", () =>
      mappedTicketForPrint(ticket.id),
    );

    return res.json({
      message: hold.alreadyHeld
        ? "Ticket already prepared for print"
        : "Ticket prepared for print",
      alreadyHeld: hold.alreadyHeld,
      deductedAmount: hold.deductedAmount,
      cashierWalletBalance: hold.balanceAfter,
      ticket: mapped,
    });
  } catch (error) {
    const handled = await respondPrintWalletError(req, res, error);
    if (handled) return handled;
    console.error("preparePrintTicket error:", error);
    return res.status(500).json({ message: "Failed to prepare ticket print" });
  }
}

/**
 * POST /api/tickets/:id/abort-print
 * Releases a live print hold after local print failure. Ticket stays OPEN.
 */
export async function abortPrintTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return res.status(404).json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
    }
    if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (ticket.status === "PRINTED") {
      return res.status(400).json({
        message: "Cannot abort a print-confirmed ticket",
      });
    }
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can abort print",
      });
    }

    const existing = await findCashierPrintBet(prisma, ticket.id);
    if (!existing) {
      const wallet = await prisma.wallet.findUnique({
        where: { id: cashier.wallet_id },
        select: { balance: true },
      });
      return res.json({
        message: "Print hold was already released",
        aborted: false,
        refundedAmount: 0,
        cashierWalletBalance: Number(wallet?.balance || 0),
      });
    }

    const result = await withWalletLock(cashier.wallet_id, {}, async () =>
      prisma.$transaction(async (tx) =>
        abortCashierPrintHoldInTx(tx, { ticketId: ticket.id }),
      ),
    );

    await logAuditEvent({
      req,
      action: "TICKET_PRINT_ABORTED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      meta: {
        cashierId: cashier.id,
        refundedAmount: result.refunded,
        reason: result.reason,
      },
    });

    const wallet = await prisma.wallet.findUnique({
      where: { id: cashier.wallet_id },
      select: { balance: true },
    });

    return res.json({
      message: result.aborted
        ? "Print hold released and cashier wallet refunded"
        : "Print hold was already released",
      aborted: result.aborted,
      refundedAmount: result.refunded,
      cashierWalletBalance:
        result.balanceAfter ?? Number(wallet?.balance || 0),
    });
  } catch (error) {
    const handled = await respondPrintWalletError(req, res, error);
    if (handled) return handled;
    console.error("abortPrintTicket error:", error);
    return res.status(500).json({ message: "Failed to abort ticket print" });
  }
}

/**
 * PATCH /api/tickets/:id/confirm-print
 * Marks OPEN → PRINTED after paper is sent. Debit already happened in
 * prepare-print; this path only charges when an older client skipped the hold.
 */
export async function confirmPrintTicket(req, res) {
  try {
    const requestBody = req.body ?? {};
    const acceptOddsChanges = parseAcceptOddsChanges(
      requestBody.acceptOddsChanges,
    );
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { selections: true },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return res.status(404).json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
    }
    if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const existingPrint = await findCashierPrintBet(prisma, ticket.id);
    if (existingPrint || ticket.status === "PRINTED") {
      if (!ticket.receipt_number) {
        try {
          const rn = await reserveUniqueReceiptNumber(prisma);
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: { receipt_number: rn },
          });
        } catch (e) {
          console.error("confirmPrint assign receipt (alreadyPrinted)", e);
        }
      }
      if (ticket.status === "OPEN") {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: "PRINTED" },
        });
        await logAuditEvent({
          req,
          action: "TICKET_PRINT_CONFIRMED",
          module: "TICKETS",
          entityType: "TICKET",
          entityId: ticket.id,
          meta: {
            cashierId: cashier.id,
            deductedAmount: 0,
            heldInPrepare: true,
          },
        });
      }
      const wallet = await prisma.wallet.findUnique({
        where: { id: existingPrint?.wallet_id || cashier.wallet_id },
        select: { balance: true },
      });
      return res.json({
        message: "Print confirmed",
        alreadyPrinted: true,
        deductedAmount: 0,
        cashierWalletBalance: Number(wallet?.balance || 0),
        ticket: await mappedTicketForPrint(ticket.id),
      });
    }
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can be print-confirmed",
      });
    }

    const validation = await validateOpenTicketForPrint({
      prismaClient: prisma,
      ticket,
      cashierId: cashier.id,
      requestBody,
      acceptOddsChanges,
    });

    if (!validation.ok) {
      await logValidationFailure({
        action: "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
        req,
        code: validation.logCode,
        meta: validation.logMeta || {},
      });
      return res.status(validation.statusCode).json(validation.body);
    }

    if (acceptOddsChanges && validation.validated) {
      await applyAcceptedPrintOdds(ticket, validation.validated);
    }

    const result = await withWalletLock(cashier.wallet_id, {}, async () =>
      prisma.$transaction(async (tx) => {
        const live = await tx.ticket.findUnique({ where: { id: ticket.id } });
        const hold = await holdCashierPrintInTx(tx, {
          ticket: live || ticket,
          cashier,
          reserveReceiptNumber: reserveUniqueReceiptNumber,
        });
        const receiptNumber = hold.ticket?.receipt_number;
        const { count } = await tx.ticket.updateMany({
          where: { id: ticket.id, status: "OPEN" },
          data: {
            status: "PRINTED",
            ...(receiptNumber ? { receipt_number: receiptNumber } : {}),
          },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }
        return hold;
      }),
    );

    await logAuditEvent({
      req,
      action: "TICKET_PRINT_CONFIRMED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      meta: {
        cashierId: cashier.id,
        ticketClaimed: !ticket.cashier_id,
        deductedAmount: result.deductedAmount,
        walletBalance: result.balanceAfter,
        legacyConfirmDebit: true,
      },
    });

    return res.json({
      message: result.alreadyHeld
        ? "Print confirmed"
        : "Print confirmed and cashier wallet deducted",
      alreadyPrinted: result.alreadyHeld,
      deductedAmount: result.deductedAmount,
      cashierWalletBalance: result.balanceAfter,
      ticket: await mappedTicketForPrint(ticket.id),
    });
  } catch (error) {
    const handled = await respondPrintWalletError(req, res, error);
    if (handled) return handled;
    console.error("confirmPrintTicket error:", error);
    return res.status(500).json({ message: "Failed to confirm ticket print" });
  }
}

function cloneSelectionRowsForRepeat(selections = []) {
  return selections.map((sel) => ({
    match_id: sel.match_id,
    fixture_id: sel.fixture_id,
    selection: sel.selection,
    market_code: sel.market_code,
    market_params: sel.market_params ?? undefined,
    odds: sel.odds,
    server_odds: sel.server_odds,
    server_odds_at: sel.server_odds_at,
    server_odds_hash: sel.server_odds_hash,
    market_state: sel.market_state,
    live_at_placement: Boolean(sel.live_at_placement),
    result: "PENDING",
    market_version: sel.market_version,
    server_market_version: sel.server_market_version,
  }));
}

/**
 * POST /api/tickets/:id/repeat
 * Clones a ticket as a new OPEN sale (same coupon/selections, new receipt on print).
 */
export async function repeatTicket(req, res) {
  try {
    const source = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        selections: ticketSelectionRelationArgs,
      },
    });
    if (!source) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (source.cashier_id && source.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const snapshot = Array.isArray(source.selection_snapshot)
      ? source.selection_snapshot
      : [];
    const selectionRows = cloneSelectionRowsForRepeat(source.selections || []);

    const created = await prisma.ticket.create({
      data: {
        coupon_number: source.coupon_number,
        user_id: source.user_id,
        cashier_id: null,
        branch_name: "",
        branch_location: "",
        stake: source.stake,
        total_odds: source.total_odds,
        accumulator_bonus_percent: source.accumulator_bonus_percent,
        potential_win: source.potential_win,
        apply_winnings_tax: source.apply_winnings_tax,
        winnings_tax_rate: source.winnings_tax_rate,
        selection_snapshot: snapshot,
        status: "OPEN",
        channel: source.channel,
        validation_meta: source.validation_meta ?? undefined,
        ...(selectionRows.length > 0
          ? { selections: { create: selectionRows } }
          : {}),
      },
      include: ticketDetailInclude,
    });

    await logAuditEvent({
      req,
      action: "TICKET_REPEATED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: created.id,
      before: { sourceTicketId: source.id },
      after: { id: created.id, couponNumber: created.coupon_number },
    });

    return res.status(201).json(mapTicket(created));
  } catch (error) {
    console.error("repeatTicket error:", error);
    return res.status(500).json({ message: "Failed to repeat ticket" });
  }
}

/**
 * DELETE /api/tickets/:id/selections/:selectionId
 * Removes a leg from an OPEN ticket before print (cashier can remove any selection).
 * Remaining legs are not placement-validated here; prepare-print does that.
 */
export async function removeTicketSelection(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        selections: ticketSelectionRelationArgs,
      },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can have selections removed",
      });
    }

    if (req.user.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id && ticket.cashier_id !== cashier.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const printReference = `ticket-print:${ticket.id}`;
    const existingPrint = await prisma.transaction.findFirst({
      where: { type: "BET", reference: printReference },
      select: { id: true },
    });
    if (existingPrint) {
      return res.status(400).json({
        message: "Selections cannot be removed after the ticket has been printed",
      });
    }

    const removal = evaluateTicketSelectionRemoval(
      ticket.selections || [],
      req.params.selectionId,
    );
    if (!removal.ok) {
      return res.status(removal.status).json({ message: removal.message });
    }

    const {
      selectionIndex,
      targetSelection,
      remainingSelections,
      nextTotalOdds,
    } = removal;

    const snapshot = Array.isArray(ticket.selection_snapshot)
      ? [...ticket.selection_snapshot]
      : [];
    const nextSnapshot = snapshot.filter((_, idx) => idx !== selectionIndex);

    const legCount = remainingSelections.length;
    const numericStake = Number(ticket.stake);
    const [accResolved, limits] = await Promise.all([
      resolveAccumulatorForNewTicket(
        prisma,
        legCount,
        numericStake,
        nextTotalOdds,
      ),
      resolveBettingLimits(prisma),
    ]);
    const nextPotentialWin = capGrossPotentialWin(
      limits,
      accResolved.potential_win,
    );
    const limitMsg = getStakeAndPotentialWinViolation(
      limits,
      numericStake,
      nextPotentialWin,
    );
    if (limitMsg) {
      return res.status(400).json({ message: limitMsg });
    }

    await prisma.$transaction(async (tx) => {
      await tx.ticketSelection.delete({ where: { id: targetSelection.id } });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          total_odds: nextTotalOdds,
          accumulator_bonus_percent: accResolved.accumulator_bonus_percent,
          potential_win: nextPotentialWin,
          selection_snapshot: nextSnapshot,
        },
      });
    });

    const updated = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: ticketDetailInclude,
    });

    await logAuditEvent({
      req,
      action: "TICKET_SELECTION_REMOVED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { selectionId: targetSelection.id, index: selectionIndex },
      after: {
        totalOdds: nextTotalOdds,
        potentialWin: nextPotentialWin,
        legCount,
      },
    });

    return res.json(mapTicket(updated));
  } catch (error) {
    console.error("removeTicketSelection error:", error);
    return res.status(500).json({ message: "Failed to remove selection" });
  }
}
