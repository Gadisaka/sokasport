/**
 * Admin-configured display + verification targets for online deposit channels.
 */

export const ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY = "ONLINE_DEPOSIT_RECEIVERS";

/** @typedef {{ receiverName: string, receiverAccount: string }} CbeReceiver */
/** @typedef {{ receiverName: string, receiverPhone: string }} MmReceiver */
/** @typedef {{ receiverName: string, receiverPhone: string, receiverAccount: string }} CbeBirrReceiver */

export const DEFAULT_ONLINE_DEPOSIT_RECEIVERS = {
  cbe: { receiverName: "", receiverAccount: "" },
  telebirr: { receiverName: "", receiverPhone: "" },
  cbebirr: { receiverName: "", receiverPhone: "", receiverAccount: "" },
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
      if (key === "cbebirr" && typeof chunk.receiverAccount === "string")
        base.cbebirr.receiverAccount = chunk.receiverAccount.trim();
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
      if (key === "cbebirr" && chunk.receiverAccount !== undefined) {
        if (typeof chunk.receiverAccount !== "string") {
          return {
            ok: false,
            message: "cbebirr.receiverAccount must be a string",
          };
        }
        merged.cbebirr.receiverAccount = chunk.receiverAccount.trim();
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
 * Matches an account/phone identifier that may arrive masked ("2519****0278")
 * or with a trailing holder name ("0910872474 - SOME NAME").
 */
function accountIdentifierMatches(configValue, verifyValue) {
  const cfgDigits = digitsOnly(configValue);
  if (cfgDigits.length < 4) return false;
  const raw = String(verifyValue ?? "");
  const segments = raw
    .split(/\*+/)
    .map((part) => digitsOnly(part))
    .filter((s) => s.length >= 2);
  if (segments.length === 0) return false;

  if (raw.includes("*")) {
    return segments.every((seg) => cfgDigits.includes(seg));
  }

  const cfgTail = cfgDigits.slice(-9);
  return segments.some((seg) => {
    const segTail = seg.slice(-9);
    if (cfgTail.length < 6 || segTail.length < 6) return false;
    return cfgTail.endsWith(segTail) || segTail.endsWith(cfgTail);
  });
}

/**
 * True when the platform's receiving account for this channel is configured.
 * Without it there is nothing to compare the verified payee against, so
 * deposits must be refused rather than credited.
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS} cfg
 * @returns {boolean}
 */
export function isReceiverConfigured(method, cfg) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return (cfg?.cbe?.receiverAccount ?? "").length > 0;
  if (m === "telebirr") return (cfg?.telebirr?.receiverPhone ?? "").length > 0;
  if (m === "cbebirr") {
    return (
      (cfg?.cbebirr?.receiverPhone ?? "").length > 0 ||
      (cfg?.cbebirr?.receiverAccount ?? "").length > 0
    );
  }
  return false;
}

/**
 * Fails closed: an unconfigured channel never matches, so no payment made to a
 * third party can be credited. The receiving account must match, and the
 * receiver name is additionally enforced when configured.
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS} cfg
 * @param {Record<string, unknown>} verifyData
 * @returns {boolean}
 */
export function verifyResponseMatchesReceivers(method, cfg, verifyData) {
  const m = String(method).toLowerCase();
  if (!isReceiverConfigured(m, cfg)) return false;

  if (m === "cbe") {
    const { receiverName, receiverAccount } = cfg.cbe;
    const recvName = String(verifyData?.receiver ?? "");
    const recvAcc = String(verifyData?.receiverAccount ?? "");
    if (!cbeAccountMatches(receiverAccount, recvAcc)) return false;
    if (receiverName && !nameMatchesConfigured(receiverName, recvName)) {
      return false;
    }
    return true;
  }
  if (m === "telebirr") {
    const { receiverName, receiverPhone } = cfg.telebirr;
    const d =
      verifyData?.data && typeof verifyData.data === "object"
        ? verifyData.data
        : {};
    const name = String(d.creditedPartyName ?? "");
    const acct = String(d.creditedPartyAccountNo ?? "");
    if (!telebirrAccountMatchesConfig(receiverPhone, acct)) return false;
    if (receiverName && !nameMatchesConfigured(receiverName, name)) return false;
    return true;
  }
  if (m === "cbebirr") {
    const { receiverName, receiverPhone, receiverAccount } = cfg.cbebirr;
    const recvName = String(verifyData?.receiverName ?? "");
    const credit = String(verifyData?.creditAccount ?? "");
    const identifierOk =
      (receiverPhone && accountIdentifierMatches(receiverPhone, credit)) ||
      (receiverAccount && accountIdentifierMatches(receiverAccount, credit));
    if (!identifierOk) return false;
    if (receiverName && !nameMatchesConfigured(receiverName, recvName)) {
      return false;
    }
    return true;
  }
  return false;
}
