import { randomUUID } from "node:crypto";
import { getRedisClient } from "../services/cacheService.js";

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const metrics = {
  lockAttempts: 0,
  lockAcquired: 0,
  lockBusy: 0,
  lockErrors: 0,
  waitMsTotal: 0,
};

function lockKey(walletId) {
  return `wallet:lock:${walletId}`;
}

export function getWalletLockMetrics() {
  const attempts = metrics.lockAttempts || 0;
  return {
    ...metrics,
    avgWaitMs: attempts > 0 ? metrics.waitMsTotal / attempts : 0,
  };
}

export async function withWalletLock(walletId, options = {}, callback) {
  if (!walletId) {
    throw new Error("WALLET_LOCK_WALLET_ID_REQUIRED");
  }
  const ttlMs = Math.max(
    500,
    Number(options.ttlMs || process.env.WALLET_LOCK_TTL_MS || 5000),
  );
  const token = options.token || randomUUID();
  const redis = getRedisClient();
  const startedAt = Date.now();
  metrics.lockAttempts += 1;

  let acquired = false;
  try {
    const result = await redis.set(lockKey(walletId), token, "PX", ttlMs, "NX");
    acquired = result === "OK";
    if (!acquired) {
      metrics.lockBusy += 1;
      const err = new Error("WALLET_BUSY");
      err.code = "wallet_busy";
      throw err;
    }
    metrics.lockAcquired += 1;
    return await callback({
      walletId,
      token,
      ttlMs,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error?.code !== "wallet_busy") {
      metrics.lockErrors += 1;
    }
    throw error;
  } finally {
    metrics.waitMsTotal += Date.now() - startedAt;
    if (acquired) {
      try {
        await redis.eval(RELEASE_SCRIPT, 1, lockKey(walletId), token);
      } catch {
        // lock auto-expiry is the fallback safety.
      }
    }
  }
}

