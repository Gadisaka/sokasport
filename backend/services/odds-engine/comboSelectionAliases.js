/**
 * Expand compound selection labels into API-Sports value strings stored in DB.
 * The UI uppercases labels on click ("HOME/YES") while ingestion keeps provider
 * casing ("Home/Yes") and abbreviated variants ("1/O 2.5", "U/YES 2.5").
 * Mirrors the parsing helpers in apiSportsCatalogHandlers.js combo validators.
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

export function expandCompoundSelectionCandidates(raw) {
  const label = String(raw || "").trim();
  if (!label.includes("/")) return [];

  const out = new Set();
  const parts = label.split("/");

  if (parts.length !== 2) return [];

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
