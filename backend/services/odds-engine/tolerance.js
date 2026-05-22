function toNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getOddsTolerance({ live = false, selectionsCount = 1 } = {}) {
  if (live) {
    return toNumberOr(process.env.LIVE_ODDS_TOLERANCE, 0);
  }
  if (Number(selectionsCount) <= 1) {
    return toNumberOr(process.env.PREMATCH_SINGLE_TOLERANCE, 0.05);
  }
  return toNumberOr(process.env.PREMATCH_ODDS_TOLERANCE, 0.02);
}

export function oddsWithinTolerance(submittedOdds, serverOdds, tolerance) {
  const a = Number(submittedOdds);
  const b = Number(serverOdds);
  const t = Number(tolerance);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t)) {
    return false;
  }
  return Math.abs(a - b) <= t;
}
