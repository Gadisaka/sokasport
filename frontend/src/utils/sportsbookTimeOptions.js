const HOUR_BUCKET_IDS = [
  { id: "1h", label: "1H", labelKey: "time.hour1h" },
  { id: "3h", label: "3H", labelKey: "time.hour3h" },
  { id: "12h", label: "12H", labelKey: "time.hour12h" },
];

/** @type {readonly string[]} */
const WEEKDAY_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * i18n path for calendar-day tabs (`time.today`, `time.tomorrow`, `days.mon`, …).
 * Offsets 2–8 use short weekday; other offsets return null (use generated `label`).
 *
 * @param {number} offset
 * @param {Date} dateAtOffset
 * @returns {string | null}
 */
export function timeOptionLabelKey(offset, dateAtOffset) {
  const o = Number(offset);
  if (o === 0) return "time.today";
  if (o === 1) return "time.tomorrow";
  if (o >= 2 && o <= 8 && dateAtOffset instanceof Date) {
    const d = dateAtOffset.getDay();
    const key = WEEKDAY_KEY[d];
    return key ? `days.${key}` : null;
  }
  return null;
}

/** Calendar-day tab ids for offsets `0 .. windowDays - 1` (aligned with prematch horizon). */
export function buildDayTimeIds(windowDays = 14) {
  const safe = Math.min(Math.max(Number(windowDays) || 14, 2), 31);
  const ids = [];
  for (let offset = 0; offset < safe; offset += 1) {
    const id = dayOffsetToTimeId(offset);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Labels for calendar offsets: Today / Tomorrow; offsets 2–8 short weekday;
 * offset ≥ 9 lowercase short month + day (e.g. `apr 4`).
 *
 * @param {Date} dateAtOffset — calendar date for this tab (local midnight + offset days from “today”).
 * @param {number} offset — 0-based day offset from local today.
 */
export function calendarDayTabLabel(dateAtOffset, offset) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset >= 2 && offset <= 8) {
    return dateAtOffset.toLocaleDateString(undefined, { weekday: "short" });
  }
  return dateAtOffset
    .toLocaleDateString("en-GB", { month: "short", day: "numeric" })
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {Date} [now] — optional fixed date for testing
 * @param {number} [windowDays] — calendar offsets 0..windowDays-1 (default 14)
 */
export function buildSportsbookTimeOptions(now = new Date(), windowDays = 14) {
  const safe = Math.min(Math.max(Number(windowDays) || 14, 2), 31);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  /** @type {{ id: string, label: string, labelKey: string | null }[]} */
  const dayParts = [];
  for (let offset = 0; offset < safe; offset += 1) {
    const id = dayOffsetToTimeId(offset);
    if (!id) continue;
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    const label = calendarDayTabLabel(d, offset);
    dayParts.push({
      id,
      label,
      labelKey: timeOptionLabelKey(offset, d),
    });
  }

  return [...HOUR_BUCKET_IDS, ...dayParts];
}

/** Map calendar offset to stable time ids (`today`, `tomorrow`, `day2`, …). */
export function dayOffsetToTimeId(offset) {
  const o = Number(offset);
  if (o === 0) return "today";
  if (o === 1) return "tomorrow";
  if (o >= 2 && Number.isFinite(o)) return `day${o}`;
  return null;
}

/** Inverse of calendar tabs only — hour buckets (`1h`, …) return null. */
export function calendarTimeIdToUtcDayOffset(timeId) {
  const tid = String(timeId || "");
  if (tid === "today") return 0;
  if (tid === "tomorrow") return 1;
  const m = /^day(\d+)$/i.exec(tid);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Next calendar tab id within `horizonDays` window (last day wraps to `today`).
 * Returns `null` for hour buckets and non-calendar ids.
 *
 * @param {string} timeId
 * @param {number} [horizonDays]
 * @returns {string | null}
 */
export function getNextCalendarDayTimeId(timeId, horizonDays = 14) {
  const off = calendarTimeIdToUtcDayOffset(timeId);
  if (off === null) return null;
  const safe = Math.min(Math.max(Number(horizonDays) || 14, 2), 31);
  const maxOff = safe - 1;
  const nextOff = off >= maxOff ? 0 : off + 1;
  return dayOffsetToTimeId(nextOff);
}

/** Mobile home: first N days as chips; all later days (e.g. 11 jun, 12 jun) in one dropdown. */
export const MOBILE_QUICK_DAY_COUNT = 4;
export const MOBILE_PICKER_MIN_OFFSET = 4;

export function isHourBucketTimeId(timeId) {
  const id = String(timeId || "");
  return id === "1h" || id === "3h" || id === "12h";
}

export function isCalendarDayTimeId(timeId) {
  return calendarTimeIdToUtcDayOffset(timeId) !== null;
}

/** Local calendar `YYYY-MM-DD` for a day offset from today (local midnight). */
export function localYmdForDayOffset(offset, now = new Date()) {
  const o = Number(offset);
  if (!Number.isFinite(o)) return "";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(start);
  d.setDate(d.getDate() + o);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inverse of `localYmdForDayOffset`; null when outside local today..+N. */
export function dayOffsetFromLocalYmd(ymd, now = new Date()) {
  const raw = String(ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const picked = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourMs = 24 * 60 * 60 * 1000;
  return Math.round((picked.getTime() - today.getTime()) / hourMs);
}

/**
 * @param {{ id: string, label?: string, labelKey?: string | null }[]} timeOptions
 * @param {{ id: string, label?: string, labelKey?: string | null, count?: number }[]} [dateDropdownOptions]
 * @param {number} [horizonDays]
 */
export function buildMobileCalendarGroups(
  timeOptions = [],
  { dateDropdownOptions = [], horizonDays = 14 } = {},
) {
  const safe = Math.min(Math.max(Number(horizonDays) || 14, 2), 31);
  const countsById = new Map(
    (dateDropdownOptions || []).map((o) => [o.id, o.count ?? 0]),
  );
  const metaById = new Map(
    (timeOptions || [])
      .filter((t) => isCalendarDayTimeId(t.id))
      .map((t) => [t.id, t]),
  );

  const hourBuckets = (timeOptions || []).filter((t) =>
    isHourBucketTimeId(t.id),
  );
  const quickTabs = [];
  const pickerDays = [];

  for (let off = 0; off < safe; off += 1) {
    const id = dayOffsetToTimeId(off);
    if (!id) continue;
    const meta = metaById.get(id);
    const drop = (dateDropdownOptions || []).find((o) => o.id === id);
    const entry = {
      id,
      label: drop?.label ?? meta?.label ?? id,
      labelKey: drop?.labelKey ?? meta?.labelKey ?? null,
      count: countsById.get(id) ?? drop?.count ?? 0,
      offset: off,
      ymd: localYmdForDayOffset(off),
    };

    if (off < MOBILE_QUICK_DAY_COUNT) {
      quickTabs.push(entry);
    } else if (off >= MOBILE_PICKER_MIN_OFFSET) {
      pickerDays.push(entry);
    }
  }

  return {
    hourBuckets,
    quickTabs,
    pickerDays,
    listedTabs: [],
  };
}
