export const MIN_SLIP_SELECTIONS = 1;
export const MAX_SLIP_SELECTIONS = 20;

export const BET_SLIP_TAB_IDS = ["betslip1", "betslip2", "betslip3"];

export function slipSelectionCount(selections) {
  return Array.isArray(selections) ? selections.length : 0;
}

export function slipCountsFromSlips(slips) {
  return {
    betslip1: slipSelectionCount(slips?.betslip1),
    betslip2: slipSelectionCount(slips?.betslip2),
    betslip3: slipSelectionCount(slips?.betslip3),
  };
}

export function canAddSelectionToSlip(current, oddData) {
  const list = Array.isArray(current) ? current : [];
  if (list.some((s) => s.id === oddData?.id)) {
    return { allowed: true, removing: true };
  }
  const withoutSameMatch = list.filter((s) => s.matchName !== oddData?.matchName);
  if (withoutSameMatch.length >= MAX_SLIP_SELECTIONS) {
    return {
      allowed: false,
      removing: false,
      message: `Maximum ${MAX_SLIP_SELECTIONS} matches per ticket.`,
    };
  }
  return { allowed: true, removing: false };
}

/**
 * Toggle or add a selection on the active slip (one outcome per match).
 */
export function toggleSlipSelection(current, oddData) {
  const list = Array.isArray(current) ? current : [];
  const exists = list.find((s) => s.id === oddData?.id);
  if (exists) {
    return {
      next: list.filter((s) => s.id !== oddData.id),
      blocked: false,
    };
  }

  const gate = canAddSelectionToSlip(list, oddData);
  if (!gate.allowed) {
    return { next: list, blocked: true, message: gate.message };
  }

  const withoutSameMatch = list.filter((s) => s.matchName !== oddData?.matchName);
  return {
    next: [...withoutSameMatch, oddData],
    blocked: false,
  };
}

/** Keep at most one selection per matchName, capped at MAX. */
export function clampSelectionsToMax(selections) {
  const list = Array.isArray(selections) ? selections : [];
  const byMatch = new Map();
  for (const sel of list) {
    const key = String(sel?.matchName || sel?.id || "");
    if (!key) continue;
    byMatch.set(key, sel);
  }
  return Array.from(byMatch.values()).slice(0, MAX_SLIP_SELECTIONS);
}

export function slipLegCountViolation(count) {
  if (count < MIN_SLIP_SELECTIONS) {
    return `Select at least ${MIN_SLIP_SELECTIONS} match to place a bet.`;
  }
  if (count > MAX_SLIP_SELECTIONS) {
    return `A ticket cannot have more than ${MAX_SLIP_SELECTIONS} matches.`;
  }
  return null;
}
