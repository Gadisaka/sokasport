const enabled = () => process.env.PERF_TIMING === "1";

const requestSpans = new Map();

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

export function isPerfTimingEnabled() {
  return enabled();
}

export function startRequestTiming(requestId) {
  if (!enabled()) return;
  requestSpans.set(requestId, { startedAt: nowMs(), spans: [] });
}

export function endRequestTiming(requestId) {
  if (!enabled()) return null;
  const entry = requestSpans.get(requestId);
  requestSpans.delete(requestId);
  if (!entry) return null;
  return {
    totalMs: nowMs() - entry.startedAt,
    spans: entry.spans,
  };
}

export async function perfSpan(requestId, label, fn) {
  if (!enabled()) return fn();
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    const entry = requestSpans.get(requestId);
    if (entry) {
      entry.spans.push({ label, ms: nowMs() - startedAt });
    }
  }
}

export function getRequestId(req) {
  return String(req.headers["x-request-id"] || req.id || "");
}

/** Standalone span logger (no request context). Used inside odds-engine, etc. */
export async function perfTimed(label, fn) {
  if (!enabled()) return fn();
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    console.log(`[perf] span ${label} ${(nowMs() - startedAt).toFixed(1)}ms`);
  }
}

export function slowThresholdMs() {
  const n = Number(process.env.PLACE_BET_SLOW_MS || process.env.PERF_SLOW_MS || 1000);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}
