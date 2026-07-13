import { prisma } from "../Config/db.js";
import { getRedisClient } from "../services/cacheService.js";
import { getValidationMetricsSnapshot } from "../lib/validationMetrics.js";
import { getWalletLockMetrics } from "../lib/walletLock.js";
import { getRateLimitMetricsSnapshot } from "../middleware/rateLimit.js";

function normalizeState(value) {
  const state = String(value || "")
    .trim()
    .toUpperCase();
  if (["OPEN", "LOCKED", "SUSPENDED", "CLOSED"].includes(state)) return state;
  return null;
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getLiveOddsMonitor(req, res) {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 60), 200);
    const fixtures = await prisma.fixture.findMany({
      where: { status: { in: ["LIVE", "HT"] } },
      include: {
        league: { select: { name: true } },
        home_team: { select: { name: true } },
        away_team: { select: { name: true } },
      },
      orderBy: { start_time: "asc" },
      take: limit,
    });
    const redis = getRedisClient();
    const rows = [];
    for (const fixture of fixtures) {
      const oddsKey = `live-odds:${fixture.api_fixture_id}`;
      const stateKey = `live-market-state:${fixture.api_fixture_id}`;
      const versionKey = `live-market-version:${fixture.api_fixture_id}`;
      const updatedAtKey = `live-market-updated-at:${fixture.api_fixture_id}`;
      const lockUntilKey = `live-market-lock-until:${fixture.api_fixture_id}`;
      const ttl = await redis.ttl(oddsKey);
      const oddsFields = await redis.hlen(oddsKey);
      const stateFields = await redis.hlen(stateKey);
      const sampleState = await redis.hgetall(stateKey);
      const sampleVersion = await redis.hgetall(versionKey);
      const sampleUpdatedAt = await redis.hgetall(updatedAtKey);
      const sampleLockUntil = await redis.hgetall(lockUntilKey);
      const stateValues = Object.values(sampleState || {});
      const aggregatedState = stateValues.includes("SUSPENDED")
        ? "SUSPENDED"
        : stateValues.includes("LOCKED")
          ? "LOCKED"
          : stateValues.includes("CLOSED")
            ? "CLOSED"
            : "OPEN";
      rows.push({
        fixtureId: fixture.id,
        apiFixtureId: fixture.api_fixture_id,
        league: fixture.league?.name || "",
        homeTeam: fixture.home_team?.name || "",
        awayTeam: fixture.away_team?.name || "",
        status: fixture.status,
        redisCacheAgeSeconds:
          Number.isFinite(ttl) && ttl >= 0 ? Math.max(0, 20 - ttl) : null,
        redisTtlSeconds: Number.isFinite(ttl) ? ttl : null,
        redisOddsEntries: oddsFields,
        redisMarketStates: stateFields,
        marketState: aggregatedState,
        marketVersion:
          Number(Object.values(sampleVersion || {})[0]) || null,
        lastVersionChangeAt: Object.values(sampleUpdatedAt || {})[0] || null,
        lockRemainingMs: Math.max(
          0,
          Number(Object.values(sampleLockUntil || {})[0] || 0) - Date.now(),
        ),
        dbOddsAgeSeconds: null,
        stale:
          !Number.isFinite(ttl) ||
          ttl < 0 ||
          oddsFields === 0 ||
          stateFields === 0,
      });
    }
    return res.json({
      generatedAt: new Date().toISOString(),
      items: rows,
    });
  } catch (error) {
    console.error("getLiveOddsMonitor error:", error);
    return res.status(500).json({ message: "Failed to load live odds monitor" });
  }
}

export async function getTicketValidationMonitor(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 40), 200);
    const skip = (page - 1) * limit;
    const code = String(req.query.code || "").trim().toLowerCase();
    const userId = String(req.query.userId || "").trim();
    const actorRole = String(req.query.actorRole || "").trim().toUpperCase();

    const where = {
      action: {
        in: [
          "TICKET_PLACE_VALIDATION_FAILED",
          "TICKET_PLACE_ODDS_CHANGED",
          "TICKET_CONFIRM_PRINT_VALIDATION_FAILED",
        ],
      },
    };
    if (userId) where.user_id = userId;
    if (actorRole) where.actor_role = actorRole;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { fullname: true } } },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const items = logs
      .map((log) => ({
        id: log.id,
        createdAt: log.created_at,
        action: log.action,
        actorRole: log.actor_role || "",
        actorName: log.user?.fullname || "System",
        code: String(log.meta?.code || "").toLowerCase(),
        fixtureId: log.meta?.fixtureId || null,
        userId: log.user_id || null,
        details: log.meta || {},
      }))
      .filter((row) => (code ? row.code === code : true));

    return res.json({
      page,
      limit,
      total,
      items,
    });
  } catch (error) {
    console.error("getTicketValidationMonitor error:", error);
    return res.status(500).json({ message: "Failed to load validation monitor" });
  }
}

export async function setLiveMarketState(req, res) {
  try {
    const fixtureId = Number.parseInt(req.params.apiFixtureId, 10);
    const state = normalizeState(req.body?.state);
    if (!Number.isFinite(fixtureId)) {
      return res.status(400).json({ message: "Invalid fixture id" });
    }
    if (!state) {
      return res.status(400).json({ message: "Invalid market state" });
    }
    const marketKey = String(req.body?.marketKey || "").trim();
    if (!marketKey) {
      return res.status(400).json({ message: "marketKey is required" });
    }
    const redis = getRedisClient();
    const key = `live-market-state:${fixtureId}`;
    const lockUntilKey = `live-market-lock-until:${fixtureId}`;
    await redis.hset(key, marketKey, state);
    if (state === "LOCKED") {
      const lockMs = Math.max(
        1000,
        Number(req.body?.lockMs || process.env.LIVE_MARKET_LOCK_MS || 5000),
      );
      await redis.hset(lockUntilKey, marketKey, Date.now() + lockMs);
      await redis.expire(lockUntilKey, Math.ceil(lockMs / 1000) + 1);
    } else {
      await redis.hdel(lockUntilKey, marketKey);
    }
    await redis.expire(key, 300);
    return res.json({
      message: "Market state updated",
      apiFixtureId: fixtureId,
      marketKey,
      state,
    });
  } catch (error) {
    console.error("setLiveMarketState error:", error);
    return res.status(500).json({ message: "Failed to update market state" });
  }
}

export async function forceLiveFixtureResync(req, res) {
  try {
    const fixtureId = Number.parseInt(req.params.apiFixtureId, 10);
    if (!Number.isFinite(fixtureId)) {
      return res.status(400).json({ message: "Invalid fixture id" });
    }
    // Minimal operational action for now: invalidate live snapshot keys.
    const redis = getRedisClient();
    await Promise.all([
      redis.del(`live-odds:${fixtureId}`),
      redis.del(`live-market-state:${fixtureId}`),
      redis.del(`odds:fixture:${fixtureId}:raw:v2`),
    ]);
    return res.json({
      message: "Live fixture snapshot invalidated; worker will repopulate on next tick",
      apiFixtureId: fixtureId,
    });
  } catch (error) {
    console.error("forceLiveFixtureResync error:", error);
    return res.status(500).json({ message: "Failed to force fixture resync" });
  }
}

export async function getValidationMetrics(req, res) {
  try {
    return res.json({
      generatedAt: new Date().toISOString(),
      metrics: getValidationMetricsSnapshot(),
      walletLocks: getWalletLockMetrics(),
      rateLimits: getRateLimitMetricsSnapshot(),
    });
  } catch (error) {
    console.error("getValidationMetrics error:", error);
    return res.status(500).json({ message: "Failed to load validation metrics" });
  }
}

export async function getPlacementValidationLogs(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 40), 200);
    const skip = (page - 1) * limit;
    const where = {};
    const reason = String(req.query.reason || "").trim();
    const actorUserId = String(req.query.actorUserId || "").trim();
    const fixtureId = Number.parseInt(req.query.fixtureId, 10);
    const actorRole = String(req.query.actorRole || "").trim().toUpperCase();
    if (reason) where.rejection_reason = reason;
    if (actorUserId) where.actor_user_id = actorUserId;
    if (actorRole) where.actor_role = actorRole;
    if (Number.isFinite(fixtureId)) where.fixture_ids = { has: fixtureId };

    const [items, total] = await Promise.all([
      prisma.placementValidationLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.placementValidationLog.count({ where }),
    ]);
    return res.json({ page, limit, total, items });
  } catch (error) {
    console.error("getPlacementValidationLogs error:", error);
    return res.status(500).json({ message: "Failed to load placement validation logs" });
  }
}
