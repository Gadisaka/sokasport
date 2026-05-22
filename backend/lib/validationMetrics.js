const metrics = {
  total: 0,
  conflicts: 0,
  failed: 0,
  success: 0,
  latencyMsTotal: 0,
  byCode: {},
  byChannel: {},
};

export function recordValidationMetric({
  channel = "prematch",
  code = "ok",
  latencyMs = 0,
}) {
  const safeCode = String(code || "unknown");
  const safeChannel = String(channel || "prematch");
  metrics.total += 1;
  metrics.latencyMsTotal += Number(latencyMs) || 0;
  metrics.byCode[safeCode] = (metrics.byCode[safeCode] || 0) + 1;
  metrics.byChannel[safeChannel] = (metrics.byChannel[safeChannel] || 0) + 1;
  if (safeCode === "ok") metrics.success += 1;
  else if (safeCode === "odds_changed") metrics.conflicts += 1;
  else metrics.failed += 1;
}

export function getValidationMetricsSnapshot() {
  return {
    ...metrics,
    avgLatencyMs: metrics.total > 0 ? metrics.latencyMsTotal / metrics.total : 0,
  };
}
