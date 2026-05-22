import { createHash } from "node:crypto";
import { getRedisClient } from "../cacheService.js";

function freezeFieldForSelection(sel) {
  const material = JSON.stringify({
    f: sel.apiFixtureId,
    m: sel.marketCode || sel.marketLabel || "",
    p: sel.marketParams || null,
    l: sel.label,
  });
  return createHash("sha1").update(material).digest("hex");
}

export async function writeFreezeSnapshot({
  actorId,
  selections = [],
  resolved = [],
  ttlSeconds = 5,
}) {
  if (!actorId || !Array.isArray(selections) || selections.length === 0) {
    return null;
  }
  const redis = getRedisClient();
  const token = createHash("sha1")
    .update(
      JSON.stringify({
        actorId,
        at: Date.now(),
        selections: selections.map((s) => ({
          i: s.index,
          f: s.apiFixtureId,
          l: s.label,
        })),
      }),
    )
    .digest("hex");
  const key = `odds-freeze:${actorId}:${token}`;
  const resolvedByIndex = new Map(resolved.map((row) => [row.index, row]));
  const payload = {};
  for (const sel of selections) {
    const row = resolvedByIndex.get(sel.index);
    if (!row) continue;
    payload[freezeFieldForSelection(sel)] = Number(row.serverOdds);
  }
  if (Object.keys(payload).length === 0) return null;
  await redis.hset(key, payload);
  await redis.expire(key, Math.max(1, Number(ttlSeconds) || 5));
  return token;
}

export async function validateFreezeSnapshot({
  actorId,
  token,
  selections = [],
  acceptedOddsByIndex = new Map(),
}) {
  if (!actorId || !token) return false;
  const redis = getRedisClient();
  const key = `odds-freeze:${actorId}:${token}`;
  const values = await redis.hgetall(key);
  if (!values || Object.keys(values).length === 0) return false;
  for (const sel of selections) {
    const field = freezeFieldForSelection(sel);
    const frozen = Number(values[field]);
    if (!Number.isFinite(frozen)) return false;
    const accepted = Number(acceptedOddsByIndex.get(sel.index));
    if (!Number.isFinite(accepted) || accepted !== frozen) {
      return false;
    }
  }
  return true;
}
