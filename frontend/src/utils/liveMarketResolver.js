// Resolve a LIVE market (category name + selected value label) into the
// canonical { marketCode, marketParams } the backend placement guard expects —
// the live analogue of resolveCompactMarketToken for the prematch strip.
//
// The backend (services/markets/marketSupport.js) re-validates and is the
// authoritative gate; this resolver's job is to send a RESOLVABLE code plus
// best-effort params. If a param is imperfect, the backend's validate() label
// fallback re-derives it from the value label, so a near-miss degrades to
// "settled from label", never a mis-grade. Returns null for unsupported live
// markets so the caller hides/ignores them (backend would reject anyway).
//
// Keep the name set in lock-step with the backend live entries in
// PROVIDER_NAME_TO_CODE (the scope-exact live markets only).

const NAME_TO_CODE = new Map([
  ["fulltime result", "MATCH_WINNER"],
  ["final score", "MATCH_WINNER"],
  ["1x2", "MATCH_WINNER"],
  ["double chance", "DOUBLE_CHANCE"],
  ["draw no bet", "DRAW_NO_BET"],
  ["match goals", "OVER_UNDER"],
  ["over/under line", "OVER_UNDER"],
  ["goals odd/even", "ODD_EVEN"],
  ["asian handicap", "HANDICAP_ASIAN"],
  ["3-way handicap", "HANDICAP_ASIAN"],
  ["both teams to score", "BTTS"],
  ["match corners", "CORNERS_OVER_UNDER"],
  ["total corners", "CORNERS_OVER_UNDER"],
  ["asian corners", "CORNERS_OVER_UNDER"],
  ["total cards", "CARDS_OVER_UNDER"],
  ["home team goals", "TEAM_TOTAL_HOME"],
  ["away team goals", "TEAM_TOTAL_AWAY"],
]);

const num = (s) => {
  const m = String(s || "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const sideOU = (s) => {
  const v = String(s || "").toLowerCase();
  if (v.startsWith("over") || v === "o") return "OVER";
  if (v.startsWith("under") || v === "u") return "UNDER";
  return null;
};
const side3 = (s) => {
  const v = String(s || "").toLowerCase();
  if (/\bhome\b|^\s*1\b/.test(v)) return "HOME";
  if (/\bdraw\b|^\s*x\b/.test(v)) return "DRAW";
  if (/\baway\b|^\s*2\b/.test(v)) return "AWAY";
  return null;
};
const side2 = (s) => {
  const v = String(s || "").toLowerCase();
  if (/\bhome\b|^\s*1\b/.test(v)) return "HOME";
  if (/\baway\b|^\s*2\b/.test(v)) return "AWAY";
  return null;
};

// Derive { marketParams } for a code from the selected value label.
function paramsFor(code, valueLabel) {
  const v = String(valueLabel || "").trim();
  switch (code) {
    case "MATCH_WINNER":
      return { side: side3(v) };
    case "DRAW_NO_BET":
      return { side: side2(v) };
    case "DOUBLE_CHANCE": {
      const k = v.toUpperCase().replace(/\s/g, "");
      const combo = { "1X": "1X", "12": "12", X2: "X2" }[k];
      return { combination: combo };
    }
    case "OVER_UNDER":
    case "CORNERS_OVER_UNDER":
    case "CARDS_OVER_UNDER":
      return { side: sideOU(v), line: num(v) };
    case "TEAM_TOTAL_HOME":
      return { team: "HOME", side: sideOU(v), line: num(v) };
    case "TEAM_TOTAL_AWAY":
      return { team: "AWAY", side: sideOU(v), line: num(v) };
    case "ODD_EVEN": {
      const p = /odd/i.test(v) ? "ODD" : /even/i.test(v) ? "EVEN" : null;
      return { pick: p };
    }
    case "HANDICAP_ASIAN":
      return { side: side2(v), handicap: num(v) };
    case "BTTS": {
      const p = /^y|yes/i.test(v) ? "YES" : /^n|no/i.test(v) ? "NO" : null;
      return { pick: p };
    }
    default:
      return {};
  }
}

/**
 * @param {string} categoryName live market display name (e.g. "Match Goals")
 * @param {string} valueLabel selected odd value label (e.g. "Over 2.5", "Home")
 * @returns {{ marketLabel, marketCode, marketParams, label } | null}
 */
export function resolveLiveMarket(categoryName, valueLabel) {
  const code = NAME_TO_CODE.get(String(categoryName || "").toLowerCase().trim());
  if (!code) return null;
  return {
    marketLabel: categoryName,
    marketCode: code,
    marketParams: paramsFor(code, valueLabel),
    label: String(valueLabel || "").trim(),
  };
}
