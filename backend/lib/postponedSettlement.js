/** Hours to wait after a fixture becomes PST before voiding its legs. */
export const POSTPONED_WAIT_HOURS = 72;

function normalizeFixtureStatus(status) {
  return String(status || "").toUpperCase().trim();
}

/**
 * @param {Date | string | null | undefined} postponedAt
 * @param {Date} [now]
 */
export function postponedWaitExpiresAt(postponedAt, now = new Date()) {
  if (!postponedAt) return null;
  const start = postponedAt instanceof Date ? postponedAt : new Date(postponedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + POSTPONED_WAIT_HOURS * 60 * 60 * 1000);
}

/**
 * Admin / API display helper for postponed fixtures.
 *
 * @param {{ status?: string, postponed_at?: Date | string | null }} fixture
 * @param {Date} [now]
 */
export function getPostponedWaitInfo(fixture, now = new Date()) {
  const status = normalizeFixtureStatus(fixture?.status);
  const postponedAtRaw = fixture?.postponed_at ?? null;
  const postponedAt =
    postponedAtRaw instanceof Date
      ? postponedAtRaw
      : postponedAtRaw
        ? new Date(postponedAtRaw)
        : null;

  if (status !== "PST" || !postponedAt || Number.isNaN(postponedAt.getTime())) {
    return {
      postponedAt: postponedAt && !Number.isNaN(postponedAt.getTime())
        ? postponedAt
        : null,
      postponedWaitExpires: null,
      waitHoursRemaining: null,
    };
  }

  const expires = postponedWaitExpiresAt(postponedAt, now);
  const remainingMs = expires ? expires.getTime() - now.getTime() : 0;
  const waitHoursRemaining =
    remainingMs > 0 ? Math.round((remainingMs / 3_600_000) * 100) / 100 : 0;

  return {
    postponedAt,
    postponedWaitExpires: expires,
    waitHoursRemaining,
  };
}

/**
 * Whether a postponed fixture may be settled (legs voided) yet.
 *
 * @param {{ status?: string, postponed_at?: Date | string | null }} fixture
 * @param {{ force?: boolean }} [options]
 * @param {Date} [now]
 */
export function evaluatePostponedSettlementWait(fixture, options = {}, now = new Date()) {
  if (options.force) return { ok: true };

  const status = normalizeFixtureStatus(fixture?.status);
  if (status !== "PST") return { ok: true };

  const postponedAtRaw = fixture?.postponed_at ?? null;
  if (!postponedAtRaw) {
    return { ok: true };
  }

  const postponedAt =
    postponedAtRaw instanceof Date ? postponedAtRaw : new Date(postponedAtRaw);
  if (Number.isNaN(postponedAt.getTime())) {
    return { ok: true };
  }

  const waitMs = POSTPONED_WAIT_HOURS * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - postponedAt.getTime();
  if (elapsedMs < waitMs) {
    const waitHoursRemaining =
      Math.round(((waitMs - elapsedMs) / 3_600_000) * 100) / 100;
    const expires = postponedWaitExpiresAt(postponedAt, now);
    return {
      ok: false,
      reason: "postponed_wait_pending",
      waitHoursRemaining,
      postponedAt,
      postponedWaitExpires: expires,
    };
  }

  return { ok: true };
}

/**
 * Resolve `postponed_at` when fixture sync updates status.
 *
 * @param {{ status?: string, postponed_at?: Date | string | null } | null | undefined} existing
 * @param {{ status?: string }} incoming
 * @param {Date} [now]
 */
export function resolvePostponedAtOnSync(existing, incoming, now = new Date()) {
  const existingStatus = normalizeFixtureStatus(existing?.status);
  const incomingStatus = normalizeFixtureStatus(incoming?.status);

  if (incomingStatus === "PST") {
    if (existingStatus !== "PST") {
      return now;
    }
    const prev = existing?.postponed_at;
    if (prev instanceof Date) return prev;
    if (prev) {
      const parsed = new Date(prev);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  if (existingStatus === "PST" && incomingStatus !== "PST") {
    return null;
  }

  const prev = existing?.postponed_at;
  if (prev instanceof Date) return prev;
  if (prev) {
    const parsed = new Date(prev);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
