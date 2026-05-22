/**
 * Player-visible info pages stored in `settings` as JSON.
 * FAQ / Contact use structured arrays; legal pages use plain `body`.
 *
 * @module lib/playerInfoPages
 */

export const PLAYER_INFO_PAGES_SETTING_KEY = "PLAYER_INFO_PAGES";

/** All page ids (order for iteration). */
export const PLAYER_INFO_PAGE_IDS = Object.freeze([
  "faq",
  "how-to-play",
  "privacy-policy",
  "terms-and-conditions",
  "contact-us",
]);

export const PLAYER_INFO_PAGE_LABEL_BY_ID = Object.freeze({
  faq: "FAQ",
  "how-to-play": "How to play",
  "privacy-policy": "Privacy Policy",
  "terms-and-conditions": "Terms and conditions",
  "contact-us": "Contact Us",
});

/** Pages that use `{ body: string }` only. */
export const BODY_PAGE_IDS = Object.freeze([
  "how-to-play",
  "privacy-policy",
  "terms-and-conditions",
]);

export const FAQ_PAGE_ID = "faq";
export const CONTACT_PAGE_ID = "contact-us";

/** Combined character budget (all bodies + FAQ Q/A + contact text + URLs). */
export const MAX_PLAYER_INFO_PAGES_TOTAL_CHARS = 260_000;

export const MAX_FAQ_ITEMS = 150;
export const MAX_FAQ_QUESTION_LEN = 500;
export const MAX_FAQ_ANSWER_LEN = 10_000;

export const MAX_CONTACT_ENTRIES = 30;
export const MAX_CONTACT_NAME_LEN = 80;
export const MAX_INFO_PAGE_URL_LEN = 2048;

/** @typedef {{ question: string, answer: string }} FaqItem */
/** @typedef {{ logo: string, name: string, link: string }} ContactEntry */

/**
 * @param {string} trimmed
 * @param {string} fieldLabel
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateHttpsUrlString(trimmed, fieldLabel) {
  if (!trimmed) {
    return { ok: false, message: `${fieldLabel} is required` };
  }
  if (trimmed.length > MAX_INFO_PAGE_URL_LEN) {
    return { ok: false, message: `${fieldLabel} is too long` };
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") {
      return { ok: false, message: `${fieldLabel} must use https` };
    }
  } catch {
    return { ok: false, message: `${fieldLabel} is not a valid url` };
  }
  return { ok: true };
}

function emptyBodyRecord() {
  return { body: "" };
}

function emptyFaqRecord() {
  return { items: [] };
}

function emptyContactRecord() {
  return { entries: [] };
}

export function defaultPlayerInfoPagesRecord() {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const id of PLAYER_INFO_PAGE_IDS) {
    if (id === FAQ_PAGE_ID) out[id] = emptyFaqRecord();
    else if (id === CONTACT_PAGE_ID) out[id] = emptyContactRecord();
    else out[id] = emptyBodyRecord();
  }
  return out;
}

/**
 * Parse FAQ page from partial stored object (ignores legacy `body`).
 * @returns {{ items: FaqItem[] }}
 */
export function normalizeFaqPage(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return emptyFaqRecord();
  if (!Array.isArray(v.items)) return emptyFaqRecord();
  /** @type {FaqItem[]} */
  const items = [];
  for (const row of v.items) {
    if (!row || typeof row !== "object") continue;
    const q = typeof row.question === "string" ? row.question : "";
    const a = typeof row.answer === "string" ? row.answer : "";
    items.push({ question: q, answer: a });
  }
  return { items };
}

/**
 * @returns {{ entries: ContactEntry[] }}
 */
export function normalizeContactPage(v) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return emptyContactRecord();
  if (!Array.isArray(v.entries)) return emptyContactRecord();
  /** @type {ContactEntry[]} */
  const entries = [];
  for (const row of v.entries) {
    if (!row || typeof row !== "object") continue;
    const logo = typeof row.logo === "string" ? row.logo : "";
    const name = typeof row.name === "string" ? row.name : "";
    const link = typeof row.link === "string" ? row.link : "";
    entries.push({ logo, name, link });
  }
  return { entries };
}

/**
 * Extract partial record from stored JSON string.
 */
export function parsePlayerInfoPagesValue(raw) {
  if (raw == null || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    /** @type {Record<string, unknown>} */
    const out = {};
    if (
      parsed[FAQ_PAGE_ID] != null &&
      typeof parsed[FAQ_PAGE_ID] === "object"
    ) {
      out[FAQ_PAGE_ID] = normalizeFaqPage(parsed[FAQ_PAGE_ID]);
    }
    if (
      parsed[CONTACT_PAGE_ID] != null &&
      typeof parsed[CONTACT_PAGE_ID] === "object"
    ) {
      out[CONTACT_PAGE_ID] = normalizeContactPage(parsed[CONTACT_PAGE_ID]);
    }
    for (const id of BODY_PAGE_IDS) {
      const v = parsed[id];
      if (v && typeof v === "object" && typeof v.body === "string") {
        out[id] = { body: v.body };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function mergePlayerInfoPagesWithDefaults(parsedPartial) {
  const merged = defaultPlayerInfoPagesRecord();
  if (!parsedPartial || typeof parsedPartial !== "object") return merged;

  if (
    parsedPartial[FAQ_PAGE_ID] != null &&
    typeof parsedPartial[FAQ_PAGE_ID] === "object"
  ) {
    merged[FAQ_PAGE_ID] = normalizeFaqPage(parsedPartial[FAQ_PAGE_ID]);
  }
  if (
    parsedPartial[CONTACT_PAGE_ID] != null &&
    typeof parsedPartial[CONTACT_PAGE_ID] === "object"
  ) {
    merged[CONTACT_PAGE_ID] = normalizeContactPage(
      parsedPartial[CONTACT_PAGE_ID],
    );
  }
  for (const id of BODY_PAGE_IDS) {
    const v = parsedPartial[id];
    if (v && typeof v === "object" && typeof v.body === "string") {
      merged[id] = { body: v.body };
    }
  }
  return merged;
}

/**
 * Overlay client payload onto defaults (unknown shapes fall back to empty defaults per page).
 */
export function coercePlayerInfoPagesPayload(inputPages) {
  const base = defaultPlayerInfoPagesRecord();
  if (!inputPages || typeof inputPages !== "object") return base;

  if (inputPages[FAQ_PAGE_ID] != null) {
    base[FAQ_PAGE_ID] = normalizeFaqPage(inputPages[FAQ_PAGE_ID]);
  }
  if (inputPages[CONTACT_PAGE_ID] != null) {
    base[CONTACT_PAGE_ID] = normalizeContactPage(inputPages[CONTACT_PAGE_ID]);
  }
  for (const id of BODY_PAGE_IDS) {
    const incoming = inputPages[id];
    if (
      incoming != null &&
      typeof incoming === "object" &&
      typeof incoming.body === "string"
    ) {
      base[id] = { body: incoming.body };
    }
  }
  return base;
}

/**
 * @param {{ items: FaqItem[] }} faq
 * @returns {{ ok: true, items: FaqItem[] } | { ok: false, message: string }}
 */
function validateFaqItemsShape(faq) {
  const raw = faq?.items;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "FAQ items must be an array" };
  }
  if (raw.length > MAX_FAQ_ITEMS) {
    return { ok: false, message: `At most ${MAX_FAQ_ITEMS} FAQ items allowed` };
  }

  /** @type {FaqItem[]} */
  const normalized = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      return { ok: false, message: `FAQ item ${i + 1} is invalid` };
    }
    const question =
      typeof row.question === "string" ? row.question.trim() : "";
    const answer = typeof row.answer === "string" ? row.answer.trim() : "";
    const blank = question === "" && answer === "";
    const partial =
      (question === "" && answer !== "") || (question !== "" && answer === "");
    if (partial) {
      return {
        ok: false,
        message: `FAQ item ${i + 1}: both question and answer are required`,
      };
    }
    if (blank) continue;
    if (question.length > MAX_FAQ_QUESTION_LEN) {
      return { ok: false, message: `FAQ item ${i + 1}: question is too long` };
    }
    if (answer.length > MAX_FAQ_ANSWER_LEN) {
      return { ok: false, message: `FAQ item ${i + 1}: answer is too long` };
    }
    normalized.push({ question, answer });
  }
  return { ok: true, items: normalized };
}

/**
 * @param {{ entries: ContactEntry[] }} contact
 */
function validateContactEntriesShape(contact) {
  const raw = contact?.entries;
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Contact entries must be an array" };
  }
  if (raw.length > MAX_CONTACT_ENTRIES) {
    return {
      ok: false,
      message: `At most ${MAX_CONTACT_ENTRIES} social links allowed`,
    };
  }

  /** @type {ContactEntry[]} */
  const normalized = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      return { ok: false, message: `Contact row ${i + 1} is invalid` };
    }
    const logoTrim = typeof row.logo === "string" ? row.logo.trim() : "";
    const nameTrim = typeof row.name === "string" ? row.name.trim() : "";
    const linkTrim = typeof row.link === "string" ? row.link.trim() : "";

    const allEmpty = logoTrim === "" && nameTrim === "" && linkTrim === "";
    const anySet = logoTrim !== "" || nameTrim !== "" || linkTrim !== "";
    if (allEmpty) continue;

    if (logoTrim === "" || nameTrim === "" || linkTrim === "") {
      return {
        ok: false,
        message: `Contact row ${i + 1}: logo, name, and link are all required`,
      };
    }
    if (nameTrim.length > MAX_CONTACT_NAME_LEN) {
      return { ok: false, message: `Contact row ${i + 1}: name is too long` };
    }
    const logoOk = validateHttpsUrlString(logoTrim, "Logo URL");
    if (!logoOk.ok) {
      return { ok: false, message: `Contact row ${i + 1}: ${logoOk.message}` };
    }
    const linkOk = validateHttpsUrlString(linkTrim, "Link");
    if (!linkOk.ok) {
      return { ok: false, message: `Contact row ${i + 1}: ${linkOk.message}` };
    }

    normalized.push({
      logo: logoTrim,
      name: nameTrim,
      link: linkTrim,
    });
  }

  return { ok: true, entries: normalized };
}

function totalCharsPlayerInfoPages(merged) {
  let n = 0;
  for (const id of BODY_PAGE_IDS) {
    n += String(merged[id]?.body ?? "").length;
  }
  const faq = merged[FAQ_PAGE_ID];
  if (faq?.items) {
    for (const it of faq.items) {
      n += (it.question?.length ?? 0) + (it.answer?.length ?? 0);
    }
  }
  const ct = merged[CONTACT_PAGE_ID];
  if (ct?.entries) {
    for (const e of ct.entries) {
      n +=
        (e.logo?.length ?? 0) + (e.name?.length ?? 0) + (e.link?.length ?? 0);
    }
  }
  return n;
}

/**
 * @returns {{ ok: true, pages: Record<string, unknown> } | { ok: false, message: string }}
 */
export function validateMergedPlayerInfoPages(merged) {
  if (!merged || typeof merged !== "object") {
    return { ok: false, message: "pages must be an object" };
  }

  const extraKeys = Object.keys(merged).filter(
    (k) => !PLAYER_INFO_PAGE_IDS.includes(k),
  );
  if (extraKeys.length > 0) {
    return { ok: false, message: `Unknown page keys: ${extraKeys.join(", ")}` };
  }

  for (const id of BODY_PAGE_IDS) {
    const entry = merged[id];
    if (!entry || typeof entry.body !== "string") {
      return { ok: false, message: `Invalid entry for ${id}` };
    }
  }

  const faqIn = merged[FAQ_PAGE_ID];
  if (!faqIn || typeof faqIn !== "object") {
    return { ok: false, message: "Invalid FAQ entry" };
  }
  const faqVal = validateFaqItemsShape(faqIn);
  if (!faqVal.ok) return faqVal;

  const contactIn = merged[CONTACT_PAGE_ID];
  if (!contactIn || typeof contactIn !== "object") {
    return { ok: false, message: "Invalid Contact entry" };
  }
  const ctVal = validateContactEntriesShape(contactIn);
  if (!ctVal.ok) return ctVal;

  /** @type {Record<string, unknown>} */
  const pages = {};
  for (const id of BODY_PAGE_IDS) {
    pages[id] = { body: merged[id].body };
  }
  pages[FAQ_PAGE_ID] = { items: faqVal.items };
  pages[CONTACT_PAGE_ID] = { entries: ctVal.entries };

  if (totalCharsPlayerInfoPages(pages) > MAX_PLAYER_INFO_PAGES_TOTAL_CHARS) {
    return {
      ok: false,
      message: `Combined content exceeds ${MAX_PLAYER_INFO_PAGES_TOTAL_CHARS} characters`,
    };
  }

  return { ok: true, pages };
}
