import {
  endRequestTiming,
  isPerfTimingEnabled,
  slowThresholdMs,
  startRequestTiming,
} from "../lib/perfTiming.js";

export function perfTimingMiddleware(req, res, next) {
  const perfEnabled = isPerfTimingEnabled();
  const slowMs = slowThresholdMs();
  const trackSlow = slowMs > 0;
  if (!perfEnabled && !trackSlow) return next();

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  const wallStartedAt = Date.now();
  if (perfEnabled) startRequestTiming(requestId);

  res.on("finish", () => {
    const wallMs = Date.now() - wallStartedAt;
    const timing = perfEnabled ? endRequestTiming(requestId) : null;
    if (timing) {
      console.log(
        `[perf] ${req.method} ${req.originalUrl} status=${res.statusCode} total=${timing.totalMs.toFixed(1)}ms spans=${JSON.stringify(timing.spans)}`,
      );
    } else if (trackSlow && wallMs >= slowMs) {
      console.warn(
        `[perf:slow] ${req.method} ${req.originalUrl} status=${res.statusCode} total=${wallMs}ms requestId=${requestId}`,
      );
    }
  });

  next();
}
