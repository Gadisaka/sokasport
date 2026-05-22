import { getRedisClient } from "../services/cacheService.js";

function actorType(req) {
  const role = String(req.user?.role || "").toUpperCase();
  if (!role) return "anon";
  if (role === "CASHIER") return "cashier";
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "admin";
  return "auth";
}

const metrics = {
  total: 0,
  blocked: 0,
  byScope: {},
  byActorType: {},
  topActors: {},
};

export function getRateLimitMetricsSnapshot() {
  const topActors = Object.entries(metrics.topActors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([actor, blocked]) => ({ actor, blocked }));
  return {
    total: metrics.total,
    blocked: metrics.blocked,
    byScope: { ...metrics.byScope },
    byActorType: { ...metrics.byActorType },
    topActors,
  };
}

function actorId(req, scope) {
  if (scope === "cashier_login") {
    const phone = String(req.body?.phone || "").trim();
    if (phone) return `${phone}:${req.ip || "unknown"}`;
  }
  return String(req.user?.sub || req.ip || "unknown");
}

function policyFor(type, scope) {
  if (scope === "cashier_login") {
    return {
      limit: Number(process.env.RL_CASHIER_LOGIN_LIMIT || 10),
      windowSec: Number(process.env.RL_CASHIER_LOGIN_WINDOW_SEC || 900),
    };
  }

  const defaults = {
    anon: { limit: Number(process.env.RL_ANON_LIMIT || 25), windowSec: 30 },
    auth: { limit: Number(process.env.RL_AUTH_LIMIT || 60), windowSec: 30 },
    cashier: {
      limit: Number(process.env.RL_CASHIER_LIMIT || 80),
      windowSec: 30,
    },
    admin: { limit: Number(process.env.RL_ADMIN_LIMIT || 100), windowSec: 30 },
  };
  return defaults[type] || defaults.anon;
}

/** @internal test helper */
export function getRateLimitPolicyForTests(scope, type = "anon") {
  return policyFor(type, scope);
}

export function createSportsbookRateLimiter(scope) {
  return async function sportsbookRateLimit(req, res, next) {
    try {
      const type = actorType(req);
      const id = actorId(req, scope);
      const { limit, windowSec } = policyFor(type, scope);
      metrics.total += 1;
      metrics.byScope[scope] = (metrics.byScope[scope] || 0) + 1;
      metrics.byActorType[type] = (metrics.byActorType[type] || 0) + 1;
      const redis = getRedisClient();
      const nowSec = Math.floor(Date.now() / 1000);
      const bucket = Math.floor(nowSec / windowSec);
      const key = `rl:${scope}:${type}:${id}:${bucket}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec + 1);
      }
      if (count > limit) {
        metrics.blocked += 1;
        const keyActor = `${type}:${id}`;
        metrics.topActors[keyActor] = (metrics.topActors[keyActor] || 0) + 1;
        const ttl = await redis.ttl(key);
        const retryAfterSec = Math.max(1, Number(ttl) || 1);
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          code: "rate_limited",
          message: "Too many requests, please retry later.",
          retryAfterSeconds: retryAfterSec,
          scope,
        });
      }
      return next();
    } catch {
      // fail-open to avoid blocking placement on Redis issues
      return next();
    }
  };
}

