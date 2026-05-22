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
