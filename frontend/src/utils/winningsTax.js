/** Platform winnings tax from `/api/cms/platform-config`. */
export function winningsTaxRateDecimal(winningsTax) {
  if (!winningsTax?.enabled) return 0;
  const r = Number(winningsTax.rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r;
}

/** UI label e.g. "Tax 15%" or "Tax" when off. */
export function winningsTaxLabel(winningsTax) {
  const r = winningsTaxRateDecimal(winningsTax);
  if (r <= 0) return "Tax";
  const pct = r * 100;
  const rounded = Math.round(pct * 100) / 100;
  const pctStr =
    rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
  return `Tax ${pctStr}%`;
}

/** Label for bet history row using per-ticket snapshot rate when present. */
export function taxLabelForBetHistory(bet, platformWinningsTax) {
  const r = Number(bet?.winningsTaxRate);
  if (Number.isFinite(r) && r > 0) {
    const pct = r * 100;
    const rounded = Math.round(pct * 100) / 100;
    const pctStr =
      rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
    return `Tax ${pctStr}%`;
  }
  if (bet?.tax > 0) return "Tax";
  return winningsTaxLabel(platformWinningsTax);
}

/**
 * @param {string} possibleWin - display string or "—"
 * @param {object|null} winningsTax - from platform config
 */
export function slipGrossTaxNet(possibleWin, winningsTax) {
  if (possibleWin === "—") {
    return { tax: "—", netWin: "—" };
  }
  const grossNum = parseFloat(possibleWin);
  if (!Number.isFinite(grossNum)) {
    return { tax: "—", netWin: "—" };
  }
  const rate = winningsTaxRateDecimal(winningsTax);
  if (rate <= 0) {
    return { tax: "—", netWin: possibleWin };
  }
  const tax = (grossNum * rate).toFixed(2);
  const netWin = (grossNum - parseFloat(tax)).toFixed(2);
  return { tax, netWin };
}
