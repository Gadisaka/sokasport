/** Aligns with player `winningsTax` utils — cashier receipts use ticket snapshot when present. */

export function winningsTaxRateDecimal(winningsTax) {
  if (!winningsTax?.enabled) return 0;
  const r = Number(winningsTax.rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r;
}

export function slipGrossTaxNetForTicket(possibleWin, ticketLike) {
  if (possibleWin == null || possibleWin === "") {
    return { tax: null, net: null, gross: null };
  }
  const grossNum = Number(possibleWin);
  if (!Number.isFinite(grossNum)) {
    return { tax: null, net: null, gross: null };
  }
  const apply = Boolean(
    ticketLike?.applyWinningsTax ?? ticketLike?.apply_winnings_tax,
  );
  const rateRaw = ticketLike?.winningsTaxRate ?? ticketLike?.winnings_tax_rate;
  const rate = rateRaw != null && Number.isFinite(Number(rateRaw)) ? Number(rateRaw) : 0;
  if (!apply || rate <= 0) {
    return { tax: 0, net: grossNum, gross: grossNum };
  }
  const tax = Math.round(grossNum * rate * 100) / 100;
  const net = Math.round((grossNum - tax) * 100) / 100;
  return { tax, net, gross: grossNum };
}

export function formatTaxLineLabel(ticketLike, platformTax) {
  const r = Number(
    ticketLike?.winningsTaxRate ?? ticketLike?.winnings_tax_rate,
  );
  if (Number.isFinite(r) && r > 0) {
    const pct = r * 100;
    const rounded = Math.round(pct * 100) / 100;
    const pctStr =
      rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
    return `Tax ${pctStr}%`;
  }
  if (platformTax?.enabled && winningsTaxRateDecimal(platformTax) > 0) {
    const p = winningsTaxRateDecimal(platformTax) * 100;
    const rounded = Math.round(p * 100) / 100;
    const pctStr =
      rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
    return `Tax ${pctStr}%`;
  }
  return "Tax";
}
