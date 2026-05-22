/** Today as UTC calendar date `YYYY-MM-DD`. */
export function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

/** Add signed whole days to a UTC `YYYY-MM-DD` string; returns another `YYYY-MM-DD`. */
export function addUtcDaysYmd(ymd, deltaDays) {
  const raw = String(ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
  return dt.toISOString().slice(0, 10);
}

/** Parse UI date string produced by fixtureMapper (`dd/mm hh:mm yyyy`). */
export function parseUiDateToDate(uiDate) {
  const [datePart = "", timePart = "", yearPart = ""] =
    String(uiDate || "").split(" ");
  const [day = "", month = ""] = datePart.split("/");
  const [hour = "0", minute = "0"] = timePart.split(":");
  const year = Number.parseInt(yearPart, 10);
  const d = Number.parseInt(day, 10);
  const m = Number.parseInt(month, 10);
  const h = Number.parseInt(hour, 10);
  const min = Number.parseInt(minute, 10);

  if (![year, d, m, h, min].every(Number.isFinite)) return null;
  return new Date(year, m - 1, d, h, min);
}

/** Calendar day offset from local midnight "today". Null if unparsable. */
export function getCalendarDayOffset(uiDate, now = new Date()) {
  const date = parseUiDateToDate(uiDate);
  if (!date) return null;

  const hourMs = 24 * 60 * 60 * 1000;
  const matchDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((matchDay - today) / hourMs);
}

export function matchesClubNameSearch(match, needle) {
  const q = String(needle || "").trim().toLowerCase();
  if (!q) return true;
  const raw = String(match?.match || "");
  const parts = raw.split(/\s+V\s+/i);
  const home = (parts[0] || "").trim().toLowerCase();
  const away = (parts[1] || "").trim().toLowerCase();
  return home.includes(q) || away.includes(q);
}
