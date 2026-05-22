/**
 * Admin "API Configuration" endpoints — currently scoped to the
 * preferred-bookmaker feature. Super-admins use these to pick which
 * bookmaker's odds are served to the public frontend.
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import {
  PREFERRED_BOOKMAKER_SETTING_KEY,
  getPreferredBookmakerApiId,
  setPreferredBookmakerApiId,
} from "../services/settingsService.js";
import syncOdds from "../jobs/syncOdds.js";
import { getOddsHorizonDays } from "../Config/ingestionConfig.js";
import syncBookmakers from "../jobs/syncBookmakers.js";

let isManualOddsSyncRunning = false;
let isManualBookmakersSyncRunning = false;

// ─── GET /api/admin/api-config/bookmakers ────────────────────────────────────
// Returns every bookmaker we've seen, with how many odd lines reference it
// (a rough "coverage" metric for the admin UI).
export async function listBookmakers(_req, res) {
  try {
    const rows = await prisma.bookmaker.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { odd_lines: true } },
      },
    });

    const preferredApiId = await getPreferredBookmakerApiId();

    return res.json({
      preferredApiBookmakerId: preferredApiId,
      bookmakers: rows.map((bk) => ({
        id: bk.id,
        apiBookmakerId: bk.api_bookmaker_id,
        name: bk.name,
        oddLineCount: bk._count.odd_lines,
        isPreferred: preferredApiId === bk.api_bookmaker_id,
      })),
    });
  } catch (error) {
    console.error("listBookmakers error:", error);
    return res.status(500).json({ message: "Failed to load bookmakers" });
  }
}

// ─── GET /api/admin/api-config/samples?limit=3 ────────────────────────────────
// Returns a handful of upcoming/today fixtures with their full market data
// grouped per bookmaker, so super-admins can eyeball which feed offers the
// widest coverage / most competitive odds before committing.
export async function listBookmakerSamples(req, res) {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 3, 1),
      10,
    );

    const now = new Date();
    const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Prefer fixtures that actually have markets (otherwise the sample is useless).
    const fixtures = await prisma.fixture.findMany({
      where: {
        start_time: { gte: now, lte: horizon },
        markets: { some: {} },
      },
      include: {
        home_team: true,
        away_team: true,
        league: true,
        markets: {
          include: {
            odd_lines: { include: { bookmaker: true } },
          },
        },
      },
      orderBy: { start_time: "asc" },
      take: limit,
    });

    const samples = fixtures.map((fx) => {
      // Group odd lines per bookmaker so the admin UI can render a per-book
      // comparison. We also surface a compact 1X2 preview for the list view.
      const byBookmaker = new Map();

      for (const market of fx.markets || []) {
        for (const line of market.odd_lines || []) {
          const bk = line.bookmaker;
          if (!bk) continue;

          if (!byBookmaker.has(bk.api_bookmaker_id)) {
            byBookmaker.set(bk.api_bookmaker_id, {
              apiBookmakerId: bk.api_bookmaker_id,
              name: bk.name,
              markets: new Map(),
              oneXTwo: { "1": null, X: null, "2": null },
            });
          }

          const entry = byBookmaker.get(bk.api_bookmaker_id);

          if (!entry.markets.has(market.name)) {
            entry.markets.set(market.name, []);
          }
          entry.markets.get(market.name).push({
            value: line.value,
            odd: line.odd,
          });

          if (market.name === "Match Winner") {
            const key =
              line.value.toLowerCase() === "home"
                ? "1"
                : line.value.toLowerCase() === "draw"
                  ? "X"
                  : line.value.toLowerCase() === "away"
                    ? "2"
                    : null;
            if (key) entry.oneXTwo[key] = line.odd;
          }
        }
      }

      return {
        apiFixtureId: fx.api_fixture_id,
        startTime: fx.start_time,
        league: {
          name: fx.league?.name || "Unknown",
          country: fx.league?.country || "Unknown",
        },
        homeTeam: fx.home_team?.name || "Home",
        awayTeam: fx.away_team?.name || "Away",
        marketCount: fx.markets.length,
        bookmakers: Array.from(byBookmaker.values())
          .map((b) => ({
            apiBookmakerId: b.apiBookmakerId,
            name: b.name,
            marketCount: b.markets.size,
            oneXTwo: b.oneXTwo,
            markets: Array.from(b.markets.entries()).map(([name, values]) => ({
              name,
              values,
            })),
          }))
          .sort((a, b) => b.marketCount - a.marketCount),
      };
    });

    return res.json({ samples });
  } catch (error) {
    console.error("listBookmakerSamples error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load bookmaker samples" });
  }
}

// ─── GET /api/admin/api-config/bookmaker-preference ──────────────────────────
export async function getBookmakerPreference(_req, res) {
  try {
    const apiId = await getPreferredBookmakerApiId();
    if (apiId == null) {
      return res.json({ apiBookmakerId: null, bookmaker: null });
    }

    const bookmaker = await prisma.bookmaker.findUnique({
      where: { api_bookmaker_id: apiId },
    });

    return res.json({
      apiBookmakerId: apiId,
      bookmaker: bookmaker
        ? {
            id: bookmaker.id,
            apiBookmakerId: bookmaker.api_bookmaker_id,
            name: bookmaker.name,
          }
        : null,
    });
  } catch (error) {
    console.error("getBookmakerPreference error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load bookmaker preference" });
  }
}

// ─── PUT /api/admin/api-config/bookmaker-preference ──────────────────────────
// Body: { apiBookmakerId: number | null }
// Passing null clears the preference (show every bookmaker's odds again).
export async function putBookmakerPreference(req, res) {
  try {
    const raw = req.body?.apiBookmakerId;

    let apiBookmakerId = null;
    if (raw !== null && raw !== undefined && raw !== "") {
      apiBookmakerId = Number.parseInt(raw, 10);
      if (!Number.isFinite(apiBookmakerId)) {
        return res
          .status(400)
          .json({ message: "apiBookmakerId must be an integer or null" });
      }

      const exists = await prisma.bookmaker.findUnique({
        where: { api_bookmaker_id: apiBookmakerId },
      });
      if (!exists) {
        return res.status(404).json({
          message: `Bookmaker with api_bookmaker_id=${apiBookmakerId} has not been ingested yet`,
        });
      }
    }

    const before = await getPreferredBookmakerApiId();
    await setPreferredBookmakerApiId(apiBookmakerId);

    await logAuditEvent({
      req,
      action: "SETTINGS_PREFERRED_BOOKMAKER_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: PREFERRED_BOOKMAKER_SETTING_KEY,
      before: { apiBookmakerId: before },
      after: { apiBookmakerId },
    });

    return res.json({
      message: "Preferred bookmaker updated",
      apiBookmakerId,
    });
  } catch (error) {
    console.error("putBookmakerPreference error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update bookmaker preference" });
  }
}

// ─── POST /api/admin/api-config/sync-bookmakers ──────────────────────────────
// Pulls the full bookmaker catalog from API-Sports `/odds/bookmakers` and
// upserts it into the local table so the admin picker can offer every
// upstream provider, even ones we haven't ingested odds from yet.
//
// Idempotent and safe to call repeatedly. `force=true` (default for the
// manual button) bypasses the upstream cache to guarantee a fresh pull.
//
// TODO (perf): `syncBookmakers` runs synchronously in the API process,
// which blocks the event loop on a large catalog and contributes to the
// elevated API CPU. Should enqueue on a dedicated BullMQ queue (or
// reuse `LEAGUES_META`) and return 202 Accepted with the job id; the
// admin UI can poll for completion. Left as a comment because the
// frontend currently expects a synchronous result + audit-log entry.
export async function syncBookmakersFromUpstream(req, res) {
  if (isManualBookmakersSyncRunning) {
    return res.status(409).json({
      message: "A bookmaker sync is already running. Please wait.",
    });
  }

  isManualBookmakersSyncRunning = true;
  try {
    const result = await syncBookmakers({ force: true });

    await logAuditEvent({
      req,
      action: "SETTINGS_BOOKMAKERS_SYNCED",
      module: "SETTINGS",
      entityType: "SYSTEM",
      entityId: "BOOKMAKERS_CATALOG",
      before: null,
      after: { ...result, triggeredAt: new Date().toISOString() },
    });

    return res.json({
      message: "Bookmaker catalog synced from upstream",
      ...result,
    });
  } catch (error) {
    console.error("syncBookmakersFromUpstream error:", error);
    return res
      .status(500)
      .json({ message: "Failed to sync bookmakers from upstream" });
  } finally {
    isManualBookmakersSyncRunning = false;
  }
}

// ─── POST /api/admin/api-config/refresh-odds ─────────────────────────────────
// Triggers a manual odds sync so super-admins can pull fresh markets on demand
// without waiting for the cron tick.
//
// TODO (perf): `syncOdds()` is invoked inline here, which can pin the API
// process for many seconds (or minutes) on a backfill while it issues
// hundreds of upstream calls and Mongo upserts – directly contradicting
// the "API stays read-only / lightweight" rule. Should enqueue on
// QUEUE_NAMES.ODDS instead (the worker already runs `processOdds`) and
// return 202 with the job id so the admin can poll status. Leaving this
// inline for now to avoid changing the existing audit-log + UX contract.
export async function refreshOddsNow(req, res) {
  if (isManualOddsSyncRunning) {
    return res.status(409).json({
      message: "A manual odds refresh is already running. Please wait.",
    });
  }

  isManualOddsSyncRunning = true;
  try {
    await syncOdds({ horizonDays: getOddsHorizonDays() });

    await logAuditEvent({
      req,
      action: "SETTINGS_MANUAL_ODDS_REFRESH",
      module: "SETTINGS",
      entityType: "SYSTEM",
      entityId: "ODDS_SYNC",
      before: null,
      after: { triggeredAt: new Date().toISOString() },
    });

    return res.json({
      message: "Manual odds refresh completed",
    });
  } catch (error) {
    console.error("refreshOddsNow error:", error);
    return res.status(500).json({ message: "Manual odds refresh failed" });
  } finally {
    isManualOddsSyncRunning = false;
  }
}
