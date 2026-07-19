/**
 * Expand compound selection labels into API-Sports value strings stored in DB.
 * The UI uppercases labels on click ("HOME/YES") while ingestion keeps provider
 * casing ("Home/Yes") and abbreviated variants ("1/O 2.5", "U/YES 2.5").
 * Mirrors the parsing helpers in apiSportsCatalogHandlers.js combo validators.
 *
 * Double Chance combos need special handling: the DC leg is itself slash-compound
 * ("Home/Draw"), so labels like "Home/Draw/Yes" / "1X and Over 2.5" have more
 * than two slash parts or use "and"/"&" separators.
 */

const SIDE_FORMS = {
  HOME: ["Home", "1"],
  DRAW: ["Draw", "X"],
  AWAY: ["Away", "2"],
};
const OU_FORMS = {
  OVER: ["Over", "O"],
  UNDER: ["Under", "U"],
};
const BTTS_FORMS = {
  YES: ["Yes", "Y"],
  NO: ["No", "N"],
};
const DC_FORMS = {
  "1X": ["1X", "Home/Draw", "Home or Draw"],
  "12": ["12", "Home/Away", "Home or Away"],
  X2: ["X2", "Draw/Away", "Draw or Away"],
};

function side3(s) {
  const v = String(s || "").toLowerCase().trim();
  if (/\bhome\b|^1$/.test(v)) return "HOME";
  if (/\bdraw\b|^x$/.test(v)) return "DRAW";
  if (/\baway\b|^2$/.test(v)) return "AWAY";
  return null;
}

function ouOf(s) {
  const v = String(s || "").toLowerCase();
  if (/over|^o\b/.test(v)) return "OVER";
  if (/under|^u\b/.test(v)) return "UNDER";
  return null;
}

function bttsOf(s) {
  const v = String(s || "").toLowerCase().trim();
  if (/^y|yes|^gg/.test(v)) return "YES";
  if (/^n|no|^ng/.test(v)) return "NO";
  return null;
}

function numFrom(s) {
  const m = String(s || "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function addCaseVariants(set, form) {
  set.add(form);
  set.add(form.toUpperCase());
  set.add(form.toLowerCase());
  const tc = form
    .split("/")
    .map((p) => {
      const t = p.trim();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join("/");
  set.add(tc);
}

function addForms(set, forms) {
  for (const f of forms) addCaseVariants(set, f);
}

/** Longest-prefix match so "Home/Draw/…" wins over a bare "Home". */
function parseDcCombo(label) {
  const raw = String(label || "").trim();
  if (!raw) return null;
  const prefixes = [
    { re: /^(home\s*\/\s*draw|home\s+or\s+draw|1x|x1)(?=\s*(?:\/|and|&)|\s|$)/i, combination: "1X" },
    { re: /^(home\s*\/\s*away|home\s+or\s+away|12|21)(?=\s*(?:\/|and|&)|\s|$)/i, combination: "12" },
    { re: /^(draw\s*\/\s*away|draw\s+or\s+away|x2|2x)(?=\s*(?:\/|and|&)|\s|$)/i, combination: "X2" },
  ];
  for (const { re, combination } of prefixes) {
    const m = raw.match(re);
    if (!m) continue;
    let rest = raw.slice(m[0].length).trim();
    rest = rest.replace(/^(?:\/|\s*(?:and|&)\s*)/i, "").trim();
    if (!rest) return null;
    return { combination, rest };
  }
  return null;
}

function expandDcComboCandidates(label, out) {
  const parsed = parseDcCombo(label);
  if (!parsed) return;
  const dcForms = DC_FORMS[parsed.combination];
  if (!dcForms) return;

  const btts = bttsOf(parsed.rest);
  if (btts) {
    const forms = [];
    for (const dc of dcForms) {
      for (const b of BTTS_FORMS[btts]) {
        forms.push(`${dc}/${b}`);
        forms.push(`${dc} and ${b}`);
        forms.push(`${dc} & ${b}`);
      }
    }
    addForms(out, forms);
    return;
  }

  const ouSide = ouOf(parsed.rest);
  const line = numFrom(parsed.rest);
  if (ouSide && line != null) {
    const forms = [];
    const fullOu = ouSide === "OVER" ? "Over" : "Under";
    for (const dc of dcForms) {
      for (const o of OU_FORMS[ouSide]) {
        forms.push(`${dc}/${fullOu} ${line}`);
        forms.push(`${dc}/${o} ${line}`);
        forms.push(`${dc} and ${fullOu} ${line}`);
        forms.push(`${dc} & ${fullOu} ${line}`);
        forms.push(`${dc} and ${o} ${line}`);
        forms.push(`${dc} & ${o} ${line}`);
      }
    }
    addForms(out, forms);
  }
}

export function expandCompoundSelectionCandidates(raw) {
  const label = String(raw || "").trim();
  if (!label) return [];

  const out = new Set();

  // DC combos first — handles 3+ slash parts and "and"/"&" separators.
  if (
    label.includes("/") ||
    /\band\b/i.test(label) ||
    label.includes("&") ||
    /^(1x|x2|12)\b/i.test(label)
  ) {
    expandDcComboCandidates(label, out);
  }

  if (!label.includes("/")) return [...out];

  const parts = label.split("/");
  if (parts.length !== 2) return [...out];

  const [p0, p1] = parts;

  // Result / BTTS — e.g. Home/Yes, 1/YES
  const side = side3(p0);
  const btts = bttsOf(p1);
  if (side && btts) {
    const forms = [];
    for (const s of SIDE_FORMS[side]) {
      for (const b of BTTS_FORMS[btts]) forms.push(`${s}/${b}`);
    }
    addForms(out, forms);
  }

  // Result / Total — e.g. Home/Over 2.5, 1/O 2.5
  const sideRt = side3(p0);
  const ouSide = ouOf(p1);
  const line = numFrom(p1);
  if (sideRt && ouSide && line != null) {
    const forms = [];
    const fullOu = ouSide === "OVER" ? "Over" : "Under";
    for (const s of SIDE_FORMS[sideRt]) {
      for (const o of OU_FORMS[ouSide]) {
        forms.push(`${s}/${fullOu} ${line}`);
        forms.push(`${s}/${o} ${line}`);
      }
    }
    addForms(out, forms);
  }

  // Total / BTTS standard — e.g. Over 2.5/Yes (line in first part)
  const ouSide0 = ouOf(p0);
  const line0 = numFrom(p0);
  const btts1 = bttsOf(p1);
  if (ouSide0 && line0 != null && btts1) {
    const forms = [];
    const fullOu = ouSide0 === "OVER" ? "Over" : "Under";
    for (const o of OU_FORMS[ouSide0]) {
      for (const b of BTTS_FORMS[btts1]) {
        forms.push(`${fullOu} ${line0}/${b}`);
        forms.push(`${o}/${b} ${line0}`);
      }
    }
    addForms(out, forms);
  }

  // Total / BTTS abbreviated — e.g. U/YES 2.5 (line in second part)
  const ouSideAbbr = ouOf(p0);
  const line1 = numFrom(p1);
  const bttsAbbr = bttsOf(p1);
  if (ouSideAbbr && line1 != null && bttsAbbr) {
    const forms = [];
    const fullOu = ouSideAbbr === "OVER" ? "Over" : "Under";
    for (const o of OU_FORMS[ouSideAbbr]) {
      for (const b of BTTS_FORMS[bttsAbbr]) {
        forms.push(`${o}/${b} ${line1}`);
        forms.push(`${fullOu} ${line1}/${b}`);
      }
    }
    addForms(out, forms);
  }

  return [...out];
}
