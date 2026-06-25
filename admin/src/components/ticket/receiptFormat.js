/**
 * League header for thermal receipts: "Football: England Premier League".
 * Falls back gracefully when country or league parts are missing.
 */
export function formatLeagueReceiptLine({
  leagueType,
  leagueCountry,
  country: countryAlias,
  leagueName,
} = {}) {
  const sport = String(leagueType || "").trim();
  const country = String(leagueCountry || countryAlias || "").trim();
  const league = String(leagueName || "").trim();
  const geo = [country, league].filter(Boolean).join(" ");
  if (sport && geo) return `${sport}: ${geo}`;
  if (sport && league) return `${sport}: ${league}`;
  return sport || geo;
}

/**
 * Human-readable cashier + branch line for thermal receipts (HTML + ESC/POS).
 */
export function formatCashierReceiptLine(ticket) {
  const name = String(ticket?.cashierName ?? "").trim();
  const branchName = String(ticket?.branchName ?? "").trim();
  const branchLocation = String(ticket?.branchLocation ?? "").trim();
  const branchPart = [branchName, branchLocation].filter(Boolean).join(" – ");

  if (name && branchPart) return `${name} · ${branchPart}`;
  if (name) return name;
  if (branchPart) return branchPart;
  const id = String(ticket?.cashierId ?? "").trim();
  return id || "—";
}
