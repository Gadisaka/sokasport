/**
 * In-process settlement metrics.
 *
 * Mirrors `lib/validationMetrics.js`: a small set of cumulative counters held
 * in module memory and exposed through the admin metrics endpoint. These turn
 * the otherwise-silent "leg stays PENDING forever" failure into a dashboard
 * number, so the V1→V2 cutover (handled by the ops runbook) can be driven by
 * data instead of log-grepping.
 *
 * Counters are cumulative event counts (not gauges) — same convention as the
 * validation metrics. A leg that stays ungraded across multiple retry passes
 * is counted on each pass; the rate is what dashboards alert on.
 *
 * @module lib/settlementMetrics
 */

const metrics = {
  // Total ungraded-leg events observed (a terminal fixture/match left a leg
  // PENDING after grading — should be ~0 once V2 is live).
  ungradedTotal: 0,
  // Ungraded-leg events broken down by market code (e.g. CORNERS_OVER_UNDER).
  ungradedByMarket: {},
  // Fixtures detected as effectively unresolvable (terminal + still pending
  // past the critical-age threshold).
  unresolvableTotal: 0,
};

export function recordUngradedLeg({ marketCode = "unknown" } = {}) {
  const code = String(marketCode || "unknown");
  metrics.ungradedTotal += 1;
  metrics.ungradedByMarket[code] = (metrics.ungradedByMarket[code] || 0) + 1;
}

export function recordUnresolvableFixture() {
  metrics.unresolvableTotal += 1;
}

export function getSettlementMetricsSnapshot() {
  return {
    ungradedTotal: metrics.ungradedTotal,
    ungradedByMarket: { ...metrics.ungradedByMarket },
    unresolvableTotal: metrics.unresolvableTotal,
  };
}

/** Test-only: reset counters between cases. */
export function __resetSettlementMetrics() {
  metrics.ungradedTotal = 0;
  metrics.ungradedByMarket = {};
  metrics.unresolvableTotal = 0;
}
