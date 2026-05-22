/**
 * Game management controller — sports, leagues, matches, odds, result override.
 *
 * Result override flow (see docs/game-management.md):
 * 1. Admin sets match result string (e.g. "Home", "Away", "Draw").
 * 2. The shared `ticketSettlementService.settleMatch` runs the same
 *    grading and recompute logic the auto-settlement job uses, so a
 *    manual override and a feed-driven settlement always produce
 *    identical ticket outcomes (and trigger the same online-winner
 *    wallet credit path).
 * 3. Idempotency is guaranteed by `Match.settled_at`; replays are no-ops
 *    unless the caller passes `force=true`.
 *
 * @module controllers/gameController
 */
import { prisma } from "../Config/db.js";
import { settleMatch } from "../services/ticketSettlementService.js";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// ─── Sports ──────────────────────────────────────────────────────────────────

export async function listSports(_req, res) {
  try {
    const sports = await prisma.sport.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { leagues: true } } },
    });
    return res.json(sports);
  } catch (error) {
    console.error("listSports error:", error);
    return res.status(500).json({ message: "Failed to list sports" });
  }
}

export async function createSport(req, res) {
  try {
    const { name, icon } = req.body ?? {};
    if (!name) return res.status(400).json({ message: "name is required" });

    const sport = await prisma.sport.create({
      data: { name: String(name).trim(), icon: icon || null },
    });
    return res.status(201).json(sport);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Sport already exists" });
    }
    console.error("createSport error:", error);
    return res.status(500).json({ message: "Failed to create sport" });
  }
}

export async function updateSport(req, res) {
  try {
    const { name, icon } = req.body ?? {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (icon !== undefined) data.icon = icon || null;

    const sport = await prisma.sport.update({
      where: { id: req.params.id },
      data,
    });
    return res.json(sport);
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Sport not found" });
    }
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Sport name already exists" });
    }
    console.error("updateSport error:", error);
    return res.status(500).json({ message: "Failed to update sport" });
  }
}

// ─── Leagues ─────────────────────────────────────────────────────────────────

export async function listLeagues(req, res) {
  try {
    const sportId = String(req.query.sportId || "").trim();
    const where = sportId ? { sport_id: sportId } : {};

    const leagues = await prisma.league.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        sport: { select: { id: true, name: true } },
        _count: { select: { matches: true } },
      },
    });
    return res.json(leagues);
  } catch (error) {
    console.error("listLeagues error:", error);
    return res.status(500).json({ message: "Failed to list leagues" });
  }
}

export async function createLeague(req, res) {
  try {
    const { sportId, name, country } = req.body ?? {};
    if (!sportId || !name) {
      return res.status(400).json({ message: "sportId and name are required" });
    }

    const league = await prisma.league.create({
      data: {
        sport_id: String(sportId),
        name: String(name).trim(),
        country: country ? String(country).trim() : null,
      },
      include: { sport: { select: { id: true, name: true } } },
    });
    return res.status(201).json(league);
  } catch (error) {
    if (error?.code === "P2003") {
      return res.status(400).json({ message: "Invalid sportId" });
    }
    console.error("createLeague error:", error);
    return res.status(500).json({ message: "Failed to create league" });
  }
}

export async function updateLeague(req, res) {
  try {
    const { name, country, sportId } = req.body ?? {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (country !== undefined) data.country = country ? String(country).trim() : null;
    if (sportId !== undefined) data.sport_id = String(sportId);

    const league = await prisma.league.update({
      where: { id: req.params.id },
      data,
      include: { sport: { select: { id: true, name: true } } },
    });
    return res.json(league);
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "League not found" });
    }
    console.error("updateLeague error:", error);
    return res.status(500).json({ message: "Failed to update league" });
  }
}

// ─── Matches ─────────────────────────────────────────────────────────────────

export async function listMatches(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const leagueId = String(req.query.leagueId || "").trim();
    const sportId = String(req.query.sportId || "").trim();
    const status = String(req.query.status || "").trim();
    const date = String(req.query.date || "").trim();

    const where = {};
    if (leagueId) where.league_id = leagueId;
    if (sportId) where.league = { sport_id: sportId };
    if (status) where.status = status;
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      if (!Number.isNaN(start.getTime())) {
        where.start_time = { gte: start, lte: end };
      }
    }

    const [items, total] = await Promise.all([
      prisma.match.findMany({
        where,
        orderBy: { start_time: "desc" },
        skip,
        take: limit,
        include: {
          league: { include: { sport: { select: { id: true, name: true } } } },
          _count: { select: { odds: true } },
        },
      }),
      prisma.match.count({ where }),
    ]);

    return res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listMatches error:", error);
    return res.status(500).json({ message: "Failed to list matches" });
  }
}

export async function getMatch(req, res) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: {
        league: { include: { sport: true } },
        odds: { orderBy: { market: "asc" } },
      },
    });
    if (!match) return res.status(404).json({ message: "Match not found" });
    return res.json(match);
  } catch (error) {
    console.error("getMatch error:", error);
    return res.status(500).json({ message: "Failed to get match" });
  }
}

export async function createMatch(req, res) {
  try {
    const { leagueId, homeTeam, awayTeam, startTime } = req.body ?? {};
    if (!leagueId || !homeTeam || !awayTeam || !startTime) {
      return res.status(400).json({
        message: "leagueId, homeTeam, awayTeam and startTime are required",
      });
    }

    const parsedTime = new Date(startTime);
    if (Number.isNaN(parsedTime.getTime())) {
      return res.status(400).json({ message: "Invalid startTime" });
    }

    const match = await prisma.match.create({
      data: {
        league_id: String(leagueId),
        home_team: String(homeTeam).trim(),
        away_team: String(awayTeam).trim(),
        start_time: parsedTime,
        status: "NOT_STARTED",
      },
      include: { league: { include: { sport: true } } },
    });
    return res.status(201).json(match);
  } catch (error) {
    if (error?.code === "P2003") {
      return res.status(400).json({ message: "Invalid leagueId" });
    }
    console.error("createMatch error:", error);
    return res.status(500).json({ message: "Failed to create match" });
  }
}

export async function updateMatch(req, res) {
  try {
    const { homeTeam, awayTeam, startTime, leagueId } = req.body ?? {};
    const data = {};
    if (homeTeam !== undefined) data.home_team = String(homeTeam).trim();
    if (awayTeam !== undefined) data.away_team = String(awayTeam).trim();
    if (leagueId !== undefined) data.league_id = String(leagueId);
    if (startTime !== undefined) {
      const parsedTime = new Date(startTime);
      if (Number.isNaN(parsedTime.getTime())) {
        return res.status(400).json({ message: "Invalid startTime" });
      }
      data.start_time = parsedTime;
    }

    const match = await prisma.match.update({
      where: { id: req.params.id },
      data,
      include: { league: { include: { sport: true } } },
    });
    return res.json(match);
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Match not found" });
    }
    console.error("updateMatch error:", error);
    return res.status(500).json({ message: "Failed to update match" });
  }
}

/**
 * PATCH /api/admin/games/matches/:id/status
 * Body: { status: "NOT_STARTED" | "LIVE" | "SUSPENDED" | "FINISHED" }
 * Enable = NOT_STARTED, Suspend = SUSPENDED, Close = FINISHED
 */
export async function updateMatchStatus(req, res) {
  try {
    const { status } = req.body ?? {};
    const allowed = ["NOT_STARTED", "LIVE", "SUSPENDED", "FINISHED"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${allowed.join(", ")}`,
      });
    }

    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: { status },
    });
    return res.json({ message: `Match status set to ${status}`, match });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Match not found" });
    }
    console.error("updateMatchStatus error:", error);
    return res.status(500).json({ message: "Failed to update match status" });
  }
}

/**
 * PATCH /api/admin/games/matches/:id/result
 * Body: { result: string, force?: boolean }
 *
 * Delegates to `ticketSettlementService.settleMatch` so manual overrides
 * use the same engine, idempotency guard and online-winner credit path
 * as automatic fixture settlement.
 */
export async function overrideMatchResult(req, res) {
  try {
    const { result, force } = req.body ?? {};
    if (!result || typeof result !== "string") {
      return res.status(400).json({ message: "result (string) is required" });
    }

    const matchId = req.params.id;
    const summary = await settleMatch(matchId, result, {
      force: Boolean(force),
    });

    if (summary?.skipped) {
      if (summary.reason === "match_not_found") {
        return res.status(404).json({ message: "Match not found" });
      }
      if (summary.reason === "already_settled") {
        return res.status(409).json({
          message:
            "Match already settled — pass `force: true` to re-grade selections",
          settledAt: summary.settledAt,
        });
      }
      return res.status(400).json({
        message: "Match settlement skipped",
        reason: summary.reason,
      });
    }

    return res.json({ message: "Match result overridden", ...summary });
  } catch (error) {
    console.error("overrideMatchResult error:", error);
    return res.status(500).json({ message: "Failed to override match result" });
  }
}

// ─── Odds ────────────────────────────────────────────────────────────────────

export async function listOdds(req, res) {
  try {
    const matchId = req.params.matchId;
    const odds = await prisma.odd.findMany({
      where: { match_id: matchId },
      orderBy: [{ market: "asc" }, { selection: "asc" }],
    });
    return res.json(odds);
  } catch (error) {
    console.error("listOdds error:", error);
    return res.status(500).json({ message: "Failed to list odds" });
  }
}

/**
 * POST /api/admin/games/matches/:matchId/odds
 * Body: { market, selection, odds }
 */
export async function createOdd(req, res) {
  try {
    const { market, selection, odds } = req.body ?? {};
    if (!market || !selection || !odds) {
      return res.status(400).json({ message: "market, selection and odds are required" });
    }

    const numericOdds = Number(odds);
    if (!Number.isFinite(numericOdds) || numericOdds <= 1) {
      return res.status(400).json({ message: "odds must be a number greater than 1" });
    }

    const odd = await prisma.odd.create({
      data: {
        match_id: req.params.matchId,
        market: String(market).trim(),
        selection: String(selection).trim(),
        odds: numericOdds,
        status: true,
      },
    });
    return res.status(201).json(odd);
  } catch (error) {
    if (error?.code === "P2003") {
      return res.status(400).json({ message: "Invalid matchId" });
    }
    console.error("createOdd error:", error);
    return res.status(500).json({ message: "Failed to create odd" });
  }
}

export async function updateOdd(req, res) {
  try {
    const { market, selection, odds, status } = req.body ?? {};
    const data = {};
    if (market !== undefined) data.market = String(market).trim();
    if (selection !== undefined) data.selection = String(selection).trim();
    if (odds !== undefined) {
      const numericOdds = Number(odds);
      if (!Number.isFinite(numericOdds) || numericOdds <= 1) {
        return res.status(400).json({ message: "odds must be a number greater than 1" });
      }
      data.odds = numericOdds;
    }
    if (status !== undefined) data.status = Boolean(status);

    const odd = await prisma.odd.update({
      where: { id: req.params.id },
      data,
    });
    return res.json(odd);
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Odd not found" });
    }
    console.error("updateOdd error:", error);
    return res.status(500).json({ message: "Failed to update odd" });
  }
}

/** Bulk create/replace odds for a match. Body: { odds: [{ market, selection, odds }] } */
export async function bulkUpsertOdds(req, res) {
  try {
    const matchId = req.params.matchId;
    const { odds } = req.body ?? {};

    if (!Array.isArray(odds) || odds.length === 0) {
      return res.status(400).json({ message: "odds[] array is required" });
    }

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.status(404).json({ message: "Match not found" });

    const result = await prisma.$transaction(async (tx) => {
      await tx.odd.deleteMany({ where: { match_id: matchId } });

      const created = await tx.odd.createMany({
        data: odds.map((o) => ({
          match_id: matchId,
          market: String(o.market).trim(),
          selection: String(o.selection).trim(),
          odds: Number(o.odds),
          status: o.status !== undefined ? Boolean(o.status) : true,
        })),
      });

      return created;
    });

    return res.json({ message: "Odds replaced", count: result.count });
  } catch (error) {
    console.error("bulkUpsertOdds error:", error);
    return res.status(500).json({ message: "Failed to bulk upsert odds" });
  }
}
