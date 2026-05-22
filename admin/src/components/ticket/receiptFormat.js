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
