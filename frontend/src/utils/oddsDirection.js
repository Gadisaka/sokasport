/**
 * Compare previous vs latest odds for UI direction indicators.
 * @returns {"up"|"down"|null}
 */
export function oddsDirection(oldOdds, newOdds) {
  const a = Number(oldOdds);
  const b = Number(newOdds);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b > a) return "up";
  if (b < a) return "down";
  return null;
}

/**
 * Format an odds cell that may include a previous→new change with direction.
 */
export function formatOddsChangeParts(sel) {
  const current = Number(sel?.acceptedOdds ?? sel?.value);
  const previous = Number(sel?.previousOdds);
  const hasPrevious =
    Number.isFinite(previous) &&
    Number.isFinite(current) &&
    Math.abs(previous - current) > 1e-9;
  const direction = hasPrevious
    ? oddsDirection(previous, current)
    : sel?.oddsDirection || null;
  return {
    current: Number.isFinite(current)
      ? current.toFixed(2)
      : String(sel?.value ?? "—"),
    previous: hasPrevious ? previous.toFixed(2) : null,
    direction: hasPrevious ? direction : null,
  };
}
