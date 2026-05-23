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
import { notifyUserSafe } from "../lib/createNotification.js";
import { betPlacedNotification } from "../lib/notificationMessages.js";
import { resolveAccumulatorForNewTicket } from "../lib/bonusEngine.js";
import { inferMarketCode } from "../services/marketEvaluator.js";
import { MARKET_REGISTRY } from "../services/markets/registry.js";
import { tryResolveMarketCodeBetId } from "../services/markets/apiSportsBetIdMap.js";
import {
  ValidationError,
  MarketUnknownError,
} from "../services/markets/errors.js";
import { validatePlacementSelections } from "../services/odds-engine/validateSelections.js";
import { validateOpenTicketForPrint } from "../services/ticketPrintValidation.js";
import { getCache, setCache } from "../services/cacheService.js";
import { withWalletLock } from "../lib/walletLock.js";
import { logPlacementValidation } from "../lib/placementValidationLogger.js";
import { toMoney, d, sub } from "../lib/moneyDecimal.js";

function placementV2Enabled() {
  return String(process.env.PLACEMENT_VALIDATION || "").toLowerCase() === "v2";
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
function normalizeSelectionForV2(input, ctx) {
  const explicitRaw = input?.marketCode
    ? String(input.marketCode).trim()
    : null;
  const baseParams =
    input?.marketParams && typeof input.marketParams === "object"
      ? { ...input.marketParams }
      : {};

  let code = null;
  const betFromCode = explicitRaw
    ? tryResolveMarketCodeBetId(explicitRaw)
    : null;
  if (betFromCode) {
    code =
      MARKET_REGISTRY.resolveCode(betFromCode.canonical) ||
      String(betFromCode.canonical).toUpperCase().trim();
    baseParams.apiBetId = betFromCode.apiBetId;
  } else if (explicitRaw) {
    code = MARKET_REGISTRY.resolveCode(explicitRaw);
  }

  if (!code) {
    code =
      MARKET_REGISTRY.resolveCode(input?.marketLabel) ||
      MARKET_REGISTRY.resolveCode(input?.selection) ||
      MARKET_REGISTRY.resolveCode(input?.label);
  }

  if (!code) {
    throw new MarketUnknownError(
      explicitRaw ||
        input?.marketLabel ||
        input?.selection ||
        input?.label ||
        "",
    );
  }
  const label = input?.label ?? input?.selection ?? "";
  const params = MARKET_REGISTRY.validate(code, baseParams, {
    label,
    fixture: ctx?.fixture,
    match: ctx?.match,
  });
  return { marketCode: code, marketParams: params };
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const CASHIER_PROFILE_MISSING_MESSAGE =
  "Cashier profile not found. Ask admin to create/assign this cashier in Agents & Cashiers.";

function randomLowerLetter() {
  return String.fromCharCode(97 + Math.floor(Math.random() * 26));
}

/** Unique human-facing id for offline lookup / printing — two letters + six digits (lowercase) */
function buildCouponNumber() {
  const letters = randomLowerLetter() + randomLowerLetter();
  const digits = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `${letters}${digits}`;
}

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
    return buildCouponNumber();
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
    include: ticketSelectionRelationArgs,
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
    match: true,
    fixture: {
      include: {
        home_team: true,
        away_team: true,
      },
    },
  },
};

/** Full ticket payload for mapTicket — selections + selling cashier display name */
const ticketDetailInclude = {
  selections: ticketSelectionRelationArgs,
  cashier: {
    include: {
      user: { select: { name: true } },
    },
  },
};

function selectionKickoffTime(selection) {
  return selection.match?.start_time ?? selection.fixture?.start_time ?? null;
}

function buildMatchPayloadForTicketSelection(selection, snapshotEntry) {
  if (selection.match) {
    return {
      id: selection.match.id,
      homeTeam: selection.match.home_team,
      awayTeam: selection.match.away_team,
      startTime: selection.match.start_time,
      status: selection.match.status,
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
    cashierName: ticket.cashier?.user?.name ?? null,
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
function mapPublicCouponPayload(ticket) {
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
          };
        });

  const taxBreakdown = ticketWinningsTaxBreakdown(ticket);

  return {
    couponNumber: ticket.coupon_number,
    stake: ticket.stake,
    totalOdds: ticket.total_odds,
    potentialWin: ticket.potential_win,
    applyWinningsTax: Boolean(ticket.apply_winnings_tax),
    winningsTaxRate: ticket.winnings_tax_rate ?? null,
    winningsTaxAmount: taxBreakdown.taxAmount,
    netPayout: taxBreakdown.netPayout,
    selections: selectionLegs,
  };
}

/**
 * Clean pasted coupon digits/letters copy (NBSP/BOM/zero-width trimmed, inner spaces removed).
 * Coupons are alphanumeric; DB stores lowercase from `buildCouponNumber`.
 *
 * @param {unknown} raw
 * @returns {{ compact: string, compactLower: string }}
 */
function normalizeCouponLookupInput(raw) {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/\ufeff/g, "").trim();
  s = s.replace(/[\u00a0\u200b-\u200d\ufeff]/g, "").trim();
  const compact = s.replace(/\s+/g, "");
  const compactLower = compact.toLowerCase();
  return { compact, compactLower };
}

/**
 * Unique DB values we should try against `coupon_number` (handles legacy casing quirks).
 *
 * @param {string} compact
 * @param {string} compactLower
 */
function couponLookupCandidates(compact, compactLower) {
  /** @type {string[]} */
  const out = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  push(compactLower);
  push(compact);
  return out;
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

    return res.json(mapPublicCouponPayload(ticket));
  } catch (error) {
    console.error("getPublicCouponTicket error:", error);
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

    // Product of decimal odds (e.g. 2.0 * 1.5 => 3.0)
    const totalOdds = selections.reduce(
      (sum, item) => sum * Number(item.odds),
      1,
    );
    if (!Number.isFinite(totalOdds) || totalOdds <= 1) {
      return res.status(400).json({ message: "Selections odds are invalid" });
    }

    const legCount = selections.length;
    const accResolved = await resolveAccumulatorForNewTicket(
      prisma,
      legCount,
      numericStake,
      totalOdds,
    );

    const limits = await resolveBettingLimits(prisma);
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
      let marketCode;
      let marketParams;
      if (placementV2Enabled()) {
        try {
          const normalized = normalizeSelectionForV2(
            {
              marketCode: item.marketCode,
              marketLabel: item.marketLabel,
              selection: item.selection,
              marketParams: item.marketParams,
            },
            {},
          );
          marketCode = normalized.marketCode;
          marketParams = normalized.marketParams;
        } catch (err) {
          validationErrors.push({
            index: idx,
            code: err.code || "invalid",
            field: err.field || null,
            marketLabel: item.marketLabel || null,
            label: item.selection || null,
            details: err.details || null,
          });
          return null;
        }
      } else {
        marketCode = item.marketCode
          ? String(item.marketCode).toUpperCase().trim()
          : inferMarketCode({
              marketLabel: item.marketLabel,
              selection: item.selection,
            });
        marketParams =
          item.marketParams && typeof item.marketParams === "object"
            ? item.marketParams
            : undefined;
      }
      return {
        match_id: item.matchId,
        selection: item.selection,
        odds: Number(item.odds),
        market_code: marketCode,
        market_params: marketParams,
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

    const winningsTaxSnapshot = await snapshotWinningsTaxForNewTicket(prisma);

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

      if (placementV2Enabled()) {
        try {
          const normalized = normalizeSelectionForV2(
            {
              marketCode: explicitMarketCode,
              marketLabel,
              marketParams: item?.marketParams,
              label,
            },
            {},
          );
          marketCode = normalized.marketCode;
          marketParams = normalized.marketParams;
        } catch (err) {
          validationErrors.push({
            index: idx,
            code: err.code || "invalid",
            field: err.field || null,
            marketLabel,
            label,
            details: err.details || null,
          });
          return null;
        }
      } else {
        marketCode =
          explicitMarketCode ||
          inferMarketCode({ marketLabel, selection: label });
        marketParams =
          item?.marketParams && typeof item.marketParams === "object"
            ? item.marketParams
            : null;
      }

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
      const replay = await getCache(replayKey);
      if (replay && replay.payload) {
        return res.status(200).json({
          ...replay.payload,
          replayed: true,
        });
      }
    }

    if (idempotencyKey) {
      const existingTicket = await prisma.ticket.findFirst({
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
      });
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
      writeFreeze: false,
      now: new Date(),
    });

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
        serverMarketVersion: Number(
          row?.serverMarketVersion ?? item.marketVersion ?? 0,
        ),
        marketState: row?.marketState || "OPEN",
        serverUpdatedAt: row?.serverUpdatedAt || null,
      };
    });
    const totalOdds = Number(validated.totalOdds || 0);
    const legCount = normalizedSelections.length;
    const accResolved = await resolveAccumulatorForNewTicket(
      prisma,
      legCount,
      numericStake,
      totalOdds,
    );

    const limits = await resolveBettingLimits(prisma);
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
      live_at_placement: Boolean(item.fromLive),
      result: "PENDING",
    }));

    const winningsTaxSnapshot = await snapshotWinningsTaxForNewTicket(prisma);

    const ticketDataBase = {
      user_id: authenticatedUserId,
      branch_name: "",
      branch_location: "",
      stake: numericStake,
      total_odds: totalOdds,
      accumulator_bonus_percent: accResolved.accumulator_bonus_percent,
      potential_win: potentialWin,
      status: "OPEN",
      selection_snapshot: lockedSelections,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      channel: live ? "LIVE" : "PREMATCH",
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
      couponNumber = await resolveCouponNumberForCreate(
        prisma,
        rawCoupon,
        incomingSig,
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
      const playerWallet = await prisma.wallet.findFirst({
        where: { user_id: authenticatedUserId, wallet_type: "PLAYER" },
        select: { id: true },
      });
      if (!playerWallet) throw new Error("PLAYER_WALLET_NOT_FOUND");
      const result = await withWalletLock(playerWallet.id, {}, async () =>
        prisma.$transaction(async (tx) => {
          const receiptNumber = await reserveUniqueReceiptNumber(tx);

          const wallet = await tx.wallet.findFirst({
            where: { user_id: authenticatedUserId, wallet_type: "PLAYER" },
          });
          if (!wallet) throw new Error("PLAYER_WALLET_NOT_FOUND");

          const balanceBefore = toMoney(wallet.balance);
          if (balanceBefore < numericStake)
            throw new Error("INSUFFICIENT_BALANCE");

          const balanceAfter = toMoney(sub(balanceBefore, numericStake));
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: balanceAfter },
          });
          await tx.transaction.create({
            data: {
              wallet_id: wallet.id,
              type: "BET",
              amount: numericStake,
              balance_before: balanceBefore,
              balance_after: balanceAfter,
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
          return { ticket, balanceAfter };
        }),
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
      created = await prisma.ticket.create({ data });
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
    await logPlacementValidation({
      actorUserId: authenticatedUserId || null,
      actorRole: req.user?.role || (authenticatedUserId ? "PLAYER" : "PUBLIC"),
      ticketId: created.id,
      idempotencyKey,
      flowChannel: live ? "LIVE" : "PREMATCH",
      isLive: live,
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
    });
    if (replayKey) {
      await setCache(replayKey, { payload }, 600);
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
  }
}

/**
 * GET /api/tickets
 * Query filters: couponNumber, receiptId (ticket id), status, cashierId,
 * branchName, branchLocation, date (YYYY-MM-DD), page, limit
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
      where.created_at = { gte: start, lte: end };
    }

    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { created_at: "desc" },
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

    const { count } = await prisma.ticket.updateMany({
      where: { id: ticket.id, status: { in: ["OPEN", "PRINTED"] } },
      data: { status: "CANCELED" },
    });
    if (count === 0) {
      return res.status(409).json({
        message: "Ticket status changed concurrently; cancel rejected",
        code: "status_conflict",
      });
    }

    await logAuditEvent({
      req,
      action: "TICKET_CANCELED",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: "CANCELED" },
    });

    return res.json({
      message: "Ticket canceled successfully",
      ticket: { ...ticket, status: "CANCELED" },
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

        const { count } = await tx.ticket.updateMany({
          where: { id: ticket.id, status: "WON" },
          data: { status: "PAID" },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }

        return {
          paidTicket: { ...ticket, status: "PAID" },
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

/**
 * POST /api/tickets/:id/validate-print
 * Dry-run odds/market validation before physical print (no wallet debit).
 */
export async function validatePrintTicket(req, res) {
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
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can be validated for print",
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
        action: "TICKET_VALIDATE_PRINT_FAILED",
        req,
        code: validation.logCode,
        meta: validation.logMeta || {},
      });
      return res.status(validation.statusCode).json(validation.body);
    }

    return res.json({
      ok: true,
      message: "Ticket is valid for print",
      acceptOddsChanges,
    });
  } catch (error) {
    console.error("validatePrintTicket error:", error);
    return res.status(500).json({ message: "Failed to validate ticket print" });
  }
}

/**
 * POST /api/tickets/:id/prepare-print
 * Reserves receipt number for an OPEN ticket before physical print (no wallet debit).
 */
export async function preparePrintTicket(req, res) {
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
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can be prepared for print",
      });
    }

    let receiptNumber = ticket.receipt_number;
    if (!receiptNumber) {
      receiptNumber = await reserveUniqueReceiptNumber(prisma);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          receipt_number: receiptNumber,
          cashier_id: ticket.cashier_id || cashier.id,
          branch_name: ticket.branch_name || cashier.branch_name,
          branch_location: ticket.branch_location || cashier.branch_location,
        },
      });
    }

    const preparedTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: ticketDetailInclude,
    });
    const printedSet = preparedTicket?.cashier_id
      ? await getPrintedTicketIdSet({
          cashierId: preparedTicket.cashier_id,
          ticketIds: [ticket.id],
        })
      : new Set();

    return res.json({
      message: "Ticket prepared for print",
      ticket: preparedTicket
        ? mapTicket(preparedTicket, { printed: printedSet.has(ticket.id) })
        : undefined,
    });
  } catch (error) {
    console.error("preparePrintTicket error:", error);
    return res.status(500).json({ message: "Failed to prepare ticket print" });
  }
}

/**
 * PATCH /api/tickets/:id/confirm-print
 * Deducts cashier stake only after print confirmation.
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
    if (ticket.status !== "OPEN") {
      return res.status(400).json({
        message: "Only OPEN tickets can be print-confirmed",
      });
    }

    const snapshotSelections = Array.isArray(ticket.selection_snapshot)
      ? ticket.selection_snapshot
      : [];
    let normalizedForValidation = [];
    if (snapshotSelections.length > 0) {
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
      normalizedForValidation = snapshotSelections.map((entry, index) => ({
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
      const fullyStructuredSnapshot = normalizedForValidation.every(
        (row) =>
          Number.isFinite(Number(row.apiFixtureId)) &&
          row.marketLabel &&
          row.label &&
          Number.isFinite(Number(row.odds)),
      );
      if (fullyStructuredSnapshot) {
        const validated = await validatePlacementSelections({
          prismaClient: prisma,
          rawSelections: normalizedForValidation,
          live: false,
          actorId: `cashier:${cashier.id}`,
          writeFreeze: false,
          now: new Date(),
        });
        if (!validated.ok && validated.code === "odds_changed") {
          await logValidationFailure({
            action: "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
            req,
            code: "odds_changed",
            meta: { ticketId: ticket.id, selections: validated.drift },
          });
          return res.status(409).json({
            code: "odds_changed",
            requiresConfirmation: true,
            message:
              "Odds changed. Review and confirm latest odds before print.",
            selections: validated.drift,
            newTotalOdds: Number(validated.totalOdds || 0),
            acceptOddsChanges,
          });
        }
        if (!validated.ok && validated.code === "market_version_changed") {
          await logValidationFailure({
            action: "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
            req,
            code: "market_version_changed",
            meta: {
              ticketId: ticket.id,
              selections: validated.versionDrift || [],
            },
          });
          return res.status(409).json({
            code: "market_version_changed",
            requiresConfirmation: true,
            message:
              "Market version changed. Confirm latest market before print.",
            selections: validated.versionDrift || [],
            newTotalOdds: Number(validated.totalOdds || 0),
          });
        }
        if (!validated.ok && validated.code === "market_locked") {
          await logValidationFailure({
            action: "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
            req,
            code: "market_locked",
            meta: { ticketId: ticket.id },
          });
          return res.status(409).json({
            code: "market_locked",
            selections: validated.selections || [],
          });
        }
        if (!validated.ok) {
          await logValidationFailure({
            action: "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
            req,
            code: validated.code || "validation_failed",
            meta: { ticketId: ticket.id },
          });
          return res.status(409).json({
            code: validated.code || "validation_failed",
            selections: validated.selections || [],
          });
        }
        // If cashier submitted explicit acceptance with updated odds, refresh
        // ticket snapshots/rows before wallet debit so printed data stays aligned.
        if (acceptOddsChanges) {
          const resolvedByIndex = new Map(
            (validated.resolved || []).map((row) => [row.index, row]),
          );
          const nextSnapshot = snapshotSelections.map((entry, index) => {
            const row = resolvedByIndex.get(index);
            return row && Number.isFinite(row.serverOdds)
              ? {
                  ...entry,
                  odds: Number(row.serverOdds),
                  marketVersion: Number(
                    row.serverMarketVersion || entry.marketVersion || 0,
                  ),
                  serverMarketVersion: Number(row.serverMarketVersion || 0),
                  marketState: row.marketState || "OPEN",
                }
              : entry;
          });
          const limits = await resolveBettingLimits(prisma);
          const accPct = Number(ticket.accumulator_bonus_percent) || 0;
          const nextTotalOdds = Number(
            validated.totalOdds || ticket.total_odds || 0,
          );
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
          for (
            let index = 0;
            index < (ticket.selections || []).length;
            index++
          ) {
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
                market_version: Number(resolved.serverMarketVersion || 0),
                server_market_version: Number(
                  resolved.serverMarketVersion || 0,
                ),
              },
            });
          }
        }
      }
    }

    const printReference = `ticket-print:${ticket.id}`;
    const existing = await prisma.transaction.findFirst({
      where: {
        type: "BET",
        reference: printReference,
      },
      select: { id: true, wallet_id: true },
    });
    if (existing) {
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
      }
      const wallet = await prisma.wallet.findUnique({
        where: { id: existing.wallet_id || cashier.wallet_id },
        select: { balance: true },
      });
      const printedTicket = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        include: ticketDetailInclude,
      });
      const printedSet = printedTicket?.cashier_id
        ? await getPrintedTicketIdSet({
            cashierId: printedTicket.cashier_id,
            ticketIds: [ticket.id],
          })
        : new Set();
      return res.json({
        message: "Ticket was already print-confirmed",
        alreadyPrinted: true,
        deductedAmount: 0,
        cashierWalletBalance: Number(wallet?.balance || 0),
        ticket: printedTicket
          ? mapTicket(printedTicket, { printed: printedSet.has(ticket.id) })
          : undefined,
      });
    }

    const result = await withWalletLock(cashier.wallet_id, {}, async () =>
      prisma.$transaction(async (tx) => {
        let effectiveTicket = ticket;
        if (!ticket.cashier_id) {
          effectiveTicket = await tx.ticket.update({
            where: { id: ticket.id },
            data: {
              cashier_id: cashier.id,
              branch_name: cashier.branch_name,
              branch_location: cashier.branch_location,
            },
          });
        }

        const wallet = await tx.wallet.findUnique({
          where: { id: cashier.wallet_id },
        });
        if (!wallet) throw new Error("CASHIER_WALLET_NOT_FOUND");

        const stakeAmount = toMoney(effectiveTicket.stake);
        const balanceBefore = toMoney(wallet.balance);
        if (balanceBefore < stakeAmount)
          throw new Error("INSUFFICIENT_BALANCE");

        const balanceAfter = toMoney(sub(balanceBefore, stakeAmount));
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });
        await tx.transaction.create({
          data: {
            wallet_id: wallet.id,
            type: "BET",
            amount: stakeAmount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference: printReference,
          },
        });

        let receiptNumber = effectiveTicket.receipt_number;
        if (!receiptNumber) {
          receiptNumber = await reserveUniqueReceiptNumber(tx);
        }

        const { count } = await tx.ticket.updateMany({
          where: { id: effectiveTicket.id, status: "OPEN" },
          data: { status: "PRINTED", receipt_number: receiptNumber },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }
        return { stakeAmount, balanceAfter, ticketId: effectiveTicket.id };
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
        deductedAmount: result.stakeAmount,
        walletBalance: result.balanceAfter,
      },
    });

    const printedTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: ticketDetailInclude,
    });
    const printedSet = printedTicket?.cashier_id
      ? await getPrintedTicketIdSet({
          cashierId: printedTicket.cashier_id,
          ticketIds: [ticket.id],
        })
      : new Set();

    return res.json({
      message: "Print confirmed and cashier wallet deducted",
      alreadyPrinted: false,
      deductedAmount: result.stakeAmount,
      cashierWalletBalance: result.balanceAfter,
      ticket: printedTicket
        ? mapTicket(printedTicket, { printed: printedSet.has(ticket.id) })
        : undefined,
    });
  } catch (error) {
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
    if (error?.statusCode === 409) {
      return res.status(409).json({
        message: "Ticket status changed concurrently; print rejected",
        code: "status_conflict",
      });
    }
    console.error("confirmPrintTicket error:", error);
    return res.status(500).json({ message: "Failed to confirm ticket print" });
  }
}
