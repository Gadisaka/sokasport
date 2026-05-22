import { normalizeApiFixtureId } from "./fixtureId";

const STORAGE_KEY = "sokasport_betslips_v1";

const EMPTY_SLIPS = {
  betslip1: [],
  betslip2: [],
  betslip3: [],
};

export function loadBetSlipState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { slips: { ...EMPTY_SLIPS }, activeSlip: "betslip1" };
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return { slips: { ...EMPTY_SLIPS }, activeSlip: "betslip1" };
    }
    const slips = {
      betslip1: Array.isArray(data.betslip1) ? data.betslip1 : [],
      betslip2: Array.isArray(data.betslip2) ? data.betslip2 : [],
      betslip3: Array.isArray(data.betslip3) ? data.betslip3 : [],
    };
    const activeSlip = ["betslip1", "betslip2", "betslip3"].includes(
      data.activeSlip,
    )
      ? data.activeSlip
      : "betslip1";
    return { slips, activeSlip };
  } catch {
    return { slips: { ...EMPTY_SLIPS }, activeSlip: "betslip1" };
  }
}

export const BET_SLIP_STATE_EVENT = "betSlipStateUpdated";

export function notifyBetSlipStateUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BET_SLIP_STATE_EVENT));
  }
}

export function persistBetSlipState(slips, activeSlip) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        betslip1: slips.betslip1,
        betslip2: slips.betslip2,
        betslip3: slips.betslip3,
        activeSlip,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

/** Merge kickoff / status from current fixture list (helps older stored slips). */
export function enrichSelectionsFromMatches(selections, matches) {
  if (!Array.isArray(selections) || selections.length === 0) return selections;
  const byId = new Map();
  for (const m of matches || []) {
    if (m?.apiFixtureId == null) continue;
    byId.set(String(normalizeApiFixtureId(m.apiFixtureId)), m);
  }
  let changed = false;
  const out = selections.map((sel) => {
    if (sel?.apiFixtureId == null) return sel;
    const m = byId.get(String(normalizeApiFixtureId(sel.apiFixtureId)));
    if (!m) return sel;
    const kickoffAt = sel.kickoffAt || m.kickoffAt || null;
    const matchStatus = m.status ?? m.liveStatus ?? sel.matchStatus;
    if (kickoffAt === sel.kickoffAt && matchStatus === sel.matchStatus) {
      return sel;
    }
    changed = true;
    return { ...sel, kickoffAt, matchStatus };
  });
  return changed ? out : selections;
}

export function enrichSlipsFromMatches(slips, matches) {
  if (!matches?.length) return slips;
  const n1 = enrichSelectionsFromMatches(slips.betslip1, matches);
  const n2 = enrichSelectionsFromMatches(slips.betslip2, matches);
  const n3 = enrichSelectionsFromMatches(slips.betslip3, matches);
  if (n1 === slips.betslip1 && n2 === slips.betslip2 && n3 === slips.betslip3) {
    return slips;
  }
  return { betslip1: n1, betslip2: n2, betslip3: n3 };
}
