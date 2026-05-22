/**
 * Admin-configured display + verification targets for online deposit channels.
 */

export const ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY = "ONLINE_DEPOSIT_RECEIVERS";

/** @typedef {{ receiverName: string, receiverAccount: string }} CbeReceiver */
/** @typedef {{ receiverName: string, receiverPhone: string }} MmReceiver */

export const DEFAULT_ONLINE_DEPOSIT_RECEIVERS = {
  cbe: { receiverName: "", receiverAccount: "" },
  telebirr: { receiverName: "", receiverPhone: "" },
  cbebirr: { receiverName: "", receiverPhone: "" },
};

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS}
 */
function cloneDefaults() {
  return {
    cbe: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.cbe },
    telebirr: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.telebirr },
    cbebirr: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.cbebirr },
  };
}

export function parseReceiversSetting(raw) {
  const base = cloneDefaults();
  if (raw == null || raw === "") return base;
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return base;
  }
  if (!obj || typeof obj !== "object") return base;
  for (const key of ["cbe", "telebirr", "cbebirr"]) {
    const chunk = obj[key];
    if (!chunk || typeof chunk !== "object") continue;
    if (key === "cbe") {
      if (typeof chunk.receiverName === "string")
        base.cbe.receiverName = chunk.receiverName.trim();
      if (typeof chunk.receiverAccount === "string")
        base.cbe.receiverAccount = chunk.receiverAccount.trim();
    } else {
      if (typeof chunk.receiverName === "string")
        base[key].receiverName = chunk.receiverName.trim();
      if (typeof chunk.receiverPhone === "string")
        base[key].receiverPhone = chunk.receiverPhone.trim();
    }
  }
  return base;
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS } | { ok: false, message: string }}
 */
export function validateReceiversRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Invalid body" };
  }
  const merged = cloneDefaults();
  for (const key of ["cbe", "telebirr", "cbebirr"]) {
    const chunk = body[key];
    if (chunk === undefined) continue;
    if (chunk !== null && typeof chunk !== "object") {
      return { ok: false, message: `${key} must be an object` };
    }
    if (!chunk) continue;
    if (key === "cbe") {
      if (chunk.receiverName !== undefined) {
        if (typeof chunk.receiverName !== "string") {
          return { ok: false, message: "cbe.receiverName must be a string" };
        }
        merged.cbe.receiverName = chunk.receiverName.trim();
      }
      if (chunk.receiverAccount !== undefined) {
        if (typeof chunk.receiverAccount !== "string") {
          return { ok: false, message: "cbe.receiverAccount must be a string" };
        }
        merged.cbe.receiverAccount = chunk.receiverAccount.trim();
      }
    } else {
      if (chunk.receiverName !== undefined) {
        if (typeof chunk.receiverName !== "string") {
          return { ok: false, message: `${key}.receiverName must be a string` };
        }
        merged[key].receiverName = chunk.receiverName.trim();
      }
      if (chunk.receiverPhone !== undefined) {
        if (typeof chunk.receiverPhone !== "string") {
          return { ok: false, message: `${key}.receiverPhone must be a string` };
        }
        merged[key].receiverPhone = chunk.receiverPhone.trim();
      }
    }
  }
  return { ok: true, value: merged };
}

function normalizeName(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function nameMatchesConfigured(configName, verifyName) {
  const a = normalizeName(configName);
  const b = normalizeName(verifyName);
  if (!a.length || !b.length) return false;
  if (a.length < 2 || b.length < 2) return a === b;
  return b.includes(a) || a.includes(b);
}

/** Masked e.g. 2519****2566 — every visible digit run (length ≥2) must appear in configured phone digits */
function telebirrAccountMatchesConfig(configPhone, creditedPartyAccountNo) {
  const cfg = digitsOnly(configPhone);
  const raw = String(creditedPartyAccountNo ?? "");
  if (!cfg.length) return false;
  const segments = raw
    .split(/\*+/)
    .map((p) => digitsOnly(p))
    .filter((s) => s.length >= 2);
  if (segments.length === 0) {
    const all = digitsOnly(raw);
    return all.length > 0 && (cfg.includes(all) || all.includes(cfg.slice(-4)));
  }
  for (const seg of segments) {
    if (seg.length >= 3 && !cfg.includes(seg)) return false;
    if (seg.length === 2 && !cfg.includes(seg) && !cfg.endsWith(seg)) return false;
  }
  return true;
}

function cbeAccountMatches(configAcc, verifyAcc) {
  const c = digitsOnly(configAcc);
  const v = digitsOnly(verifyAcc);
  if (!c.length || !v.length) return false;
  if (c.length >= 4 && v.endsWith(c.slice(-Math.min(8, c.length)))) return true;
  if (v.length >= 4 && c.endsWith(v.slice(-Math.min(8, v.length)))) return true;
  return c === v || v.includes(c) || c.includes(v);
}

/**
 * If all configured fields for the method are empty, returns true (skip check).
 * Otherwise requires each non-empty configured field to match verify response.
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS} cfg
 * @param {Record<string, unknown>} verifyData
 * @returns {boolean}
 */
export function verifyResponseMatchesReceivers(method, cfg, verifyData) {
  const m = String(method).toLowerCase();
  if (m === "cbe") {
    const { receiverName, receiverAccount } = cfg.cbe;
    const needName = receiverName.length > 0;
    const needAcc = receiverAccount.length > 0;
    if (!needName && !needAcc) return true;
    const recvName = String(verifyData?.receiver ?? "");
    const recvAcc = String(verifyData?.receiverAccount ?? "");
    if (needName && !nameMatchesConfigured(receiverName, recvName)) return false;
    if (needAcc && !cbeAccountMatches(receiverAccount, recvAcc)) return false;
    return true;
  }
  if (m === "telebirr") {
    const { receiverName, receiverPhone } = cfg.telebirr;
    const needName = receiverName.length > 0;
    const needPhone = receiverPhone.length > 0;
    if (!needName && !needPhone) return true;
    const d = verifyData?.data && typeof verifyData.data === "object" ? verifyData.data : {};
    const name = String(d.creditedPartyName ?? "");
    const acct = String(d.creditedPartyAccountNo ?? "");
    if (needName && !nameMatchesConfigured(receiverName, name)) return false;
    if (needPhone && !telebirrAccountMatchesConfig(receiverPhone, acct)) return false;
    return true;
  }
  if (m === "cbebirr") {
    const { receiverName, receiverPhone } = cfg.cbebirr;
    const needName = receiverName.length > 0;
    const needPhone = receiverPhone.length > 0;
    if (!needName && !needPhone) return true;
    const recvName = String(verifyData?.receiverName ?? "");
    const credit = String(verifyData?.creditAccount ?? "");
    if (needName && !nameMatchesConfigured(receiverName, recvName)) return false;
    if (needPhone) {
      const p = digitsOnly(receiverPhone);
      const c = digitsOnly(credit);
      if (p.length >= 4 && c.length > 0) {
        const ok =
          c.endsWith(p.slice(-Math.min(9, p.length))) ||
          p.endsWith(c.slice(-Math.min(9, c.length))) ||
          c.includes(p.slice(-6)) ||
          p.includes(c.slice(-6));
        if (!ok) return false;
      }
    }
    return true;
  }
  return true;
}
