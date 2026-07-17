/**
 * Daily upstream API call budget for prematch odds jobs.
 *
 * Live scores / fixture syncs are intentionally not gated here so the
 * remaining headroom under the 150k API-Sports daily limit stays available
 * for match-day traffic.
 */

import { getRedisClient } from "./cacheService.js";
import { getOddsDailyCallBudget } from "../Config/ingestionConfig.js";

const BUDGET_TTL_SECONDS = 48 * 60 * 60;

// cacheService prefixes its own keys, but we talk to Redis directly here.
// Apply the same REDIS_KEY_PREFIX so multiple apps sharing one Redis
// (kizzabet / MichuBet / sokasport) each keep an independent budget counter.
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX
  ? `${process.env.REDIS_KEY_PREFIX}:`
  : "";

function utcYmd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function oddsBudgetKey(ymd = utcYmd()) {
  return `${KEY_PREFIX}api-budget:odds:${ymd}`;
}

/**
 * Pure helper for tests / pre-checks.
 * @param {number} used
 * @param {number} budget 0 = unlimited
 * @param {number} n
 */
export function canConsumeOddsBudget(used, budget, n = 1) {
  const amount = Math.max(0, Math.floor(Number(n) || 0));
  if (budget <= 0) return true;
  const already = Math.max(0, Math.floor(Number(used) || 0));
  return already + amount <= budget;
}

export async function getOddsApiBudgetUsedToday() {
  try {
    const raw = await getRedisClient().get(oddsBudgetKey());
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * Atomically consume `n` calls from today's odds budget.
 * @returns {Promise<{ allowed: boolean, used: number, budget: number, remaining: number }>}
 */
export async function tryConsumeOddsApiBudget(n = 1) {
  const budget = getOddsDailyCallBudget();
  const amount = Math.max(1, Math.floor(Number(n) || 1));

  if (budget <= 0) {
    return { allowed: true, used: 0, budget: 0, remaining: Infinity };
  }

  try {
    const client = getRedisClient();
    const key = oddsBudgetKey();
    const used = await client.incrby(key, amount);
    if (used === amount) {
      await client.expire(key, BUDGET_TTL_SECONDS);
    }
    if (used > budget) {
      // Roll back the overshoot so parallel callers see a consistent total.
      await client.decrby(key, amount);
      const current = Math.max(0, used - amount);
      return {
        allowed: false,
        used: current,
        budget,
        remaining: Math.max(0, budget - current),
      };
    }
    return {
      allowed: true,
      used,
      budget,
      remaining: Math.max(0, budget - used),
    };
  } catch (err) {
    // Fail open on Redis blips — better to slightly overspend than stall odds.
    console.warn(
      "[apiBudget] Redis unavailable, allowing odds call:",
      err?.message || err,
    );
    return {
      allowed: true,
      used: 0,
      budget,
      remaining: budget,
    };
  }
}
