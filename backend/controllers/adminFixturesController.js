/**
 * Admin fixture operations — list, detail, per-market result overrides.
 *
 * @module controllers/adminFixturesController
 */
import { prisma } from "../Config/db.js";
import { Prisma } from "@prisma/client";
import { logAuditEvent } from "../lib/auditLog.js";
import {
  buildEditableFixtureWhere,
  getFixtureEditableReason,
  isFixtureEditable,
} from "../lib/fixtureEditable.js";
import {
  buildOverrideKey,
  buildOverridePayloadFromInput,
  normalizeOverridePayload,
} from "../lib/fixtureMarketOverrides.js";
import { buildMarketGroupsForFixture } from "../services/adminFixtureMarketGroups.js";
import {
  settleFixture,
  isTerminalFixtureStatus,
} from "../services/ticketSettlementService.js";
import {
  POSTPONED_WAIT_HOURS,
  getPostponedWaitInfo,
} from "../lib/postponedSettlement.js";

const ALLOWED_OVERRIDE_STATUSES = new Set([
  "FT",
  "AET",
  "PEN",
  "AWD",
  "WO",
  "CANC",
  "ABD",
  "PST",
]);

const TERMINAL_STATUSES = ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"];
const FIXTURE_MODEL_FIELDS = new Set(
  (Prisma.dmmf.datamodel.models.find((m) => m.name === "Fixture")?.fields || []).map(
    (field) => field.name,
  ),
);
const HAS_RESULT_LOCK_FIELDS =
  FIXTURE_MODEL_FIELDS.has("result_locked_at") &&
  FIXTURE_MODEL_FIELDS.has("result_locked_by");
const HAS_MARKET_OVERRIDES_FIELD = FIXTURE_MODEL_FIELDS.has(
  "market_result_overrides",
);

/**
 * Prisma clause matching PST fixtures still inside their reschedule window.
 * Those are waiting by design, so they must not be counted as stuck.
 */
function postponedWaitingWhere(now = new Date()) {
  return {
    status: "PST",
    postponed_at: {
      gt: new Date(now.getTime() - POSTPONED_WAIT_HOURS * 60 * 60 * 1000),
    },
  };
}

function parseBoolQuery(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const s = String(value).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return defaultValue;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEditableOptions(req) {
  return {
    includeIncompletePast:
      parseBoolQuery(req.query.includeIncompletePast, false) ||
      String(req.query.filter || "").toLowerCase() === "incomplete_past",
  };
}

function mapFixtureRow(fixture, pendingLegs = 0, editableOptions = {}) {
  const editable = isFixtureEditable(fixture, editableOptions);
  const postponedWait = getPostponedWaitInfo(fixture);
  const postponedWaiting = (postponedWait.waitHoursRemaining ?? 0) > 0;
  return {
    id: fixture.id,
    apiFixtureId: fixture.api_fixture_id,
    league: fixture.league?.name || "",
    homeTeam: fixture.home_team?.name || "",
    awayTeam: fixture.away_team?.name || "",
    startTime: fixture.start_time,
    status: fixture.status,
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    htHomeScore: fixture.ht_home_score,
    htAwayScore: fixture.ht_away_score,
    settledAt: fixture.settled_at,
    gradingCompletedAt: fixture.grading_completed_at,
    postponedAt: postponedWait.postponedAt,
    postponedWaitExpires: postponedWait.postponedWaitExpires,
    waitHoursRemaining: postponedWait.waitHoursRemaining,
    postponedWaiting,
    resultVersion: fixture.result_version,
    resultLockedAt: HAS_RESULT_LOCK_FIELDS ? fixture.result_locked_at : null,
    resultLockedBy: HAS_RESULT_LOCK_FIELDS ? fixture.result_locked_by : null,
    selectionCount: fixture._count?.ticket_selections ?? 0,
    pendingLegs,
    editable,
    editableReason: getFixtureEditableReason(fixture, editableOptions),
    stuckSettlement:
      isTerminalFixtureStatus(fixture.status) &&
      fixture.grading_completed_at == null &&
      !postponedWaiting,
  };
}

function buildListWhere({ q, status, filter, editableOnly, editableOptions }) {
  const clauses = [];

  if (editableOnly) {
    clauses.push(buildEditableFixtureWhere(editableOptions));
  }

  const where = {};
  if (status) where.status = status;

  if (filter === "locked") {
    if (HAS_RESULT_LOCK_FIELDS) {
      where.result_locked_at = { not: null };
    }
  } else if (filter === "stuck") {
    where.status = { in: TERMINAL_STATUSES };
    // Mongo: `null` only matches explicit null; sync-created rows have the
    // field ABSENT, so also match `isSet: false` or stuck rows stay hidden.
    where.OR = [
      { grading_completed_at: null },
      { grading_completed_at: { isSet: false } },
    ];
    where.NOT = postponedWaitingWhere();
  }

  if (Object.keys(where).length) clauses.push(where);

  if (q) {
    const apiId = Number.parseInt(q, 10);
    const or = [];
    if (Number.isFinite(apiId)) or.push({ api_fixture_id: apiId });
    if (q.length >= 8) or.push({ id: q });
    or.push(
      { home_team: { name: { contains: q, mode: "insensitive" } } },
      { away_team: { name: { contains: q, mode: "insensitive" } } },
    );
    clauses.push({ OR: or });
  }

  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

async function loadFixtureDetail(fixtureId) {
  return prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      league: { select: { name: true } },
      home_team: { select: { name: true } },
      away_team: { select: { name: true } },
      markets: {
        include: {
          odd_lines: { select: { value: true, odd: true } },
        },
      },
    },
  });
}

function validateMarketOverrides(marketOverrides, marketGroups) {
  const groupByKey = new Map(marketGroups.map((g) => [g.key, g]));
  const errors = [];

  for (const [key, entry] of Object.entries(marketOverrides || {})) {
    const stableKey =
      entry?.marketCode != null
        ? buildOverrideKey(entry.marketCode, entry.marketParams)
        : key;
    const group = groupByKey.get(stableKey) || groupByKey.get(key);
    if (!group) {
      errors.push(`Unknown market group: ${key}`);
      continue;
    }
    const allowed = new Set(group.selectionOptions);
    for (const winner of entry.winningSelections || []) {
      if (!allowed.has(winner)) {
        errors.push(
          `Invalid winner "${winner}" for ${group.marketLabel} — must be one of offered selections`,
        );
      }
    }
  }

  return errors;
}

export async function getAdminFixturesSummary(req, res) {
  try {
    const editableOnly = parseBoolQuery(req.query.editableOnly, true);
    const editableOptions = parseEditableOptions(req);
    const baseWhere = editableOnly ? buildEditableFixtureWhere(editableOptions) : {};

    const [total, stuck, live] = await Promise.all([
      prisma.fixture.count({ where: baseWhere }),
      prisma.fixture.count({
        // AND-wrap so an OR inside baseWhere can't be clobbered, and match
        // both explicit-null and absent grading_completed_at (Mongo quirk).
        where: {
          AND: [
            baseWhere,
            { status: { in: TERMINAL_STATUSES } },
            {
              OR: [
                { grading_completed_at: null },
                { grading_completed_at: { isSet: false } },
              ],
            },
            { NOT: postponedWaitingWhere() },
          ],
        },
      }),
      prisma.fixture.count({
        where: {
          ...baseWhere,
          status: { in: ["LIVE", "HT"] },
        },
      }),
    ]);
    let locked = 0;
    if (HAS_RESULT_LOCK_FIELDS) {
      locked = await prisma.fixture.count({
        where: { ...baseWhere, result_locked_at: { not: null } },
      });
    }

    return res.json({ total, locked, stuck, live, editableOnly });
  } catch (err) {
    console.error("getAdminFixturesSummary error:", err);
    return res.status(500).json({ message: "Failed to load fixture summary" });
  }
}

export async function listAdminFixtures(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
    const skip = (page - 1) * limit;
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const filter = String(req.query.filter || "").trim().toLowerCase();
    const editableOnly = parseBoolQuery(req.query.editableOnly, true);
    const editableOptions = parseEditableOptions(req);
    const where = buildListWhere({
      q,
      status,
      filter,
      editableOnly,
      editableOptions,
    });

    const [total, fixtures] = await Promise.all([
      prisma.fixture.count({ where }),
      prisma.fixture.findMany({
        where,
        include: {
          league: { select: { name: true } },
          home_team: { select: { name: true } },
          away_team: { select: { name: true } },
          _count: { select: { ticket_selections: true } },
        },
        orderBy: { start_time: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const fixtureIds = fixtures.map((row) => row.id);
    const pendingByFixture = new Map();
    if (fixtureIds.length) {
      const pending = await prisma.ticketSelection.groupBy({
        by: ["fixture_id"],
        where: { fixture_id: { in: fixtureIds }, result: "PENDING" },
        _count: { _all: true },
      });
      for (const row of pending) {
        if (row.fixture_id) pendingByFixture.set(row.fixture_id, row._count._all);
      }
    }

    return res.json({
      items: fixtures.map((row) =>
        mapFixtureRow(row, pendingByFixture.get(row.id) || 0, editableOptions),
      ),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      editableOnly,
      includeIncompletePast: editableOptions.includeIncompletePast,
    });
  } catch (err) {
    console.error("listAdminFixtures error:", err);
    return res.status(500).json({ message: "Failed to list fixtures" });
  }
}

export async function getAdminFixtureDetail(req, res) {
  try {
    const fixture = await loadFixtureDetail(req.params.id);
    if (!fixture) {
      return res.status(404).json({ message: "Fixture not found" });
    }

    const editableOptions = parseEditableOptions(req);
    const editable = isFixtureEditable(fixture, editableOptions);
    if (!editable) {
      return res.status(403).json({
        message:
          "Fixture is not editable — only completed matches or past-day in-play (LIVE/HT)",
        editableReason: getFixtureEditableReason(fixture, editableOptions),
      });
    }

    const selections = await prisma.ticketSelection.findMany({
      where: { fixture_id: fixture.id },
      select: {
        id: true,
        selection: true,
        market_code: true,
        market_params: true,
        result: true,
      },
    });

    const pendingLegs = selections.filter((s) => s.result === "PENDING").length;
    const marketGroups = buildMarketGroupsForFixture(fixture, selections);

    return res.json({
      fixture: {
        ...mapFixtureRow(
          { ...fixture, _count: { ticket_selections: selections.length } },
          pendingLegs,
        ),
        marketResultOverrides: HAS_MARKET_OVERRIDES_FIELD
          ? normalizeOverridePayload(fixture.market_result_overrides)
          : { version: 1, markets: {} },
      },
      marketGroups,
      stats: {
        totalLegs: selections.length,
        pendingLegs,
        marketGroupCount: marketGroups.length,
      },
    });
  } catch (err) {
    console.error("getAdminFixtureDetail error:", err);
    return res.status(500).json({ message: "Failed to load fixture detail" });
  }
}

export async function patchAdminFixtureMarketResults(req, res) {
  try {
    const fixtureId = req.params.id;
    const {
      status,
      homeScore,
      awayScore,
      htHomeScore,
      htAwayScore,
      marketOverrides,
      force,
      resetLegs,
    } = req.body ?? {};

    const fixture = await loadFixtureDetail(fixtureId);
    if (!fixture) {
      return res.status(404).json({ message: "Fixture not found" });
    }
    const editableOptions = parseEditableOptions(req);
    if (!isFixtureEditable(fixture, editableOptions)) {
      return res.status(403).json({
        message: "Fixture is not editable",
        editableReason: getFixtureEditableReason(fixture, editableOptions),
      });
    }

    const selections = await prisma.ticketSelection.findMany({
      where: { fixture_id: fixture.id },
      select: {
        selection: true,
        market_code: true,
        market_params: true,
      },
    });
    const marketGroups = buildMarketGroupsForFixture(fixture, selections);
    const validationErrors = validateMarketOverrides(marketOverrides, marketGroups);
    if (validationErrors.length) {
      return res.status(400).json({
        message: "Invalid market overrides",
        errors: validationErrors,
      });
    }

    const payload = {};
    if (status !== undefined && status !== null && status !== "") {
      const upper = String(status).toUpperCase();
      if (!ALLOWED_OVERRIDE_STATUSES.has(upper)) {
        return res.status(400).json({
          message: "Invalid status",
          allowed: [...ALLOWED_OVERRIDE_STATUSES],
        });
      }
      payload.status = upper;
    }

    if (homeScore !== undefined) {
      const v = toIntOrNull(homeScore);
      if (homeScore !== null && v === null) {
        return res.status(400).json({ message: "homeScore must be a non-negative integer" });
      }
      payload.home_score = v;
    }
    if (awayScore !== undefined) {
      const v = toIntOrNull(awayScore);
      if (awayScore !== null && v === null) {
        return res.status(400).json({ message: "awayScore must be a non-negative integer" });
      }
      payload.away_score = v;
    }
    if (htHomeScore !== undefined) {
      const v = toIntOrNull(htHomeScore);
      if (htHomeScore !== null && v === null) {
        return res.status(400).json({ message: "htHomeScore must be a non-negative integer" });
      }
      payload.ht_home_score = v;
    }
    if (htAwayScore !== undefined) {
      const v = toIntOrNull(htAwayScore);
      if (htAwayScore !== null && v === null) {
        return res.status(400).json({ message: "htAwayScore must be a non-negative integer" });
      }
      payload.ht_away_score = v;
    }

    const effectiveStatus = payload.status || fixture.status;
    if (!isTerminalFixtureStatus(effectiveStatus)) {
      return res.status(400).json({
        message:
          "Set a terminal status (FT/AET/PEN/AWD/WO/CANC/ABD/PST) before saving market results",
      });
    }

    if (HAS_MARKET_OVERRIDES_FIELD && marketOverrides) {
      payload.market_result_overrides = buildOverridePayloadFromInput(
        marketOverrides,
        req.user?.sub || null,
      );
    }

    payload.result_version = (fixture.result_version || 0) + 1;
    if (HAS_RESULT_LOCK_FIELDS) {
      payload.result_locked_at = new Date();
      payload.result_locked_by = req.user?.sub || null;
    }

    const updated = await prisma.fixture.update({
      where: { id: fixture.id },
      data: payload,
    });

    const shouldForce = Boolean(force);
    const shouldResetLegs = resetLegs !== false && shouldForce;

    const settlement = await settleFixture(fixture.id, {
      force: shouldForce || fixture.grading_completed_at == null,
      resetLegs: shouldResetLegs,
    });

    await logAuditEvent({
      req,
      action: "FIXTURE_MARKET_RESULTS_OVERRIDE",
      module: "SETTLEMENT",
      entityType: "FIXTURE",
      entityId: fixture.id,
      before: {
        status: fixture.status,
        market_result_overrides: fixture.market_result_overrides,
      },
      after: {
        status: updated.status,
        market_result_overrides: updated.market_result_overrides,
      },
      meta: { settlement, marketGroupCount: marketGroups.length },
    });

    if (settlement?.skipped) {
      if (settlement.reason === "already_settled") {
        return res.status(409).json({
          message: "Fixture already settled — pass force: true to re-grade",
          settledAt: settlement.settledAt,
        });
      }
      return res.status(400).json({
        message: "Settlement skipped",
        reason: settlement.reason,
      });
    }

    return res.json({
      message: "Market results saved and settlement run",
      fixture: mapFixtureRow(updated, 0),
      settlement,
    });
  } catch (err) {
    console.error("patchAdminFixtureMarketResults error:", err);
    return res.status(500).json({ message: "Failed to save market results" });
  }
}

export async function overrideFixtureResult(req, res) {
  return patchAdminFixtureMarketResults(req, res);
}

export async function unlockFixtureResult(req, res) {
  try {
    const fixture = await prisma.fixture.findUnique({ where: { id: req.params.id } });
    if (!fixture) return res.status(404).json({ message: "Fixture not found" });
    if (!fixture.result_locked_at) {
      return res.status(400).json({ message: "Fixture is not result-locked" });
    }

    const data = {
      result_locked_at: null,
      result_locked_by: null,
    };
    if (HAS_MARKET_OVERRIDES_FIELD) {
      data.market_result_overrides = null;
    }

    const updated = await prisma.fixture.update({
      where: { id: fixture.id },
      data,
    });

    await logAuditEvent({
      req,
      action: "FIXTURE_RESULT_UNLOCK",
      module: "SETTLEMENT",
      entityType: "FIXTURE",
      entityId: fixture.id,
      before: {
        result_locked_at: fixture.result_locked_at,
        market_result_overrides: fixture.market_result_overrides,
      },
      after: {
        result_locked_at: null,
        market_result_overrides: null,
      },
    });

    return res.json({
      message: "Fixture lock and market overrides cleared",
      fixture: mapFixtureRow(updated, 0),
    });
  } catch (err) {
    console.error("unlockFixtureResult error:", err);
    return res.status(500).json({ message: "Failed to unlock fixture result" });
  }
}
