import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFixturesByDate,
  fetchFixturesLive,
  fetchFixturesUpcoming,
  fetchOddsForFixture,
} from "../services/api";
import { applyOddsToMatch, mapFixtureToMatch } from "../services/fixtureMapper";
import {
  addUtcDaysYmd,
  getCalendarDayOffset,
  matchesClubNameSearch,
  parseUiDateToDate,
  utcTodayYmd,
} from "../utils/matchTimeUtils";
import {
  buildSportsbookTimeOptions,
  calendarTimeIdToUtcDayOffset,
  dayOffsetToTimeId,
} from "../utils/sportsbookTimeOptions";

export {
  addUtcDaysYmd,
  getCalendarDayOffset,
  matchesClubNameSearch,
  parseUiDateToDate,
  utcTodayYmd,
} from "../utils/matchTimeUtils";

const USE_FIXTURES_BY_DATE =
  import.meta.env.VITE_USE_FIXTURES_BY_DATE !== "false";

export const PREMATCH_HORIZON_DAYS = Math.min(
  31,
  Math.max(
    2,
    Number.parseInt(import.meta.env.VITE_MAX_PREMATCH_DAYS || "14", 10) || 14,
  ),
);

const MAX_PREMATCH_DAYS = PREMATCH_HORIZON_DAYS;

const PREMATCH_POLL_MS_RAW = Number.parseInt(
  import.meta.env.VITE_PREMATCH_POLL_MS ?? "90000",
  10,
);
const PREMATCH_POLL_MS = Number.isFinite(PREMATCH_POLL_MS_RAW)
  ? PREMATCH_POLL_MS_RAW
  : 90_000;

/** Initial home-page fixtures fetch — never spin forever. */
const INITIAL_FIXTURES_TIMEOUT_MS = Number.parseInt(
  import.meta.env.VITE_FIXTURES_FETCH_TIMEOUT_MS || "15000",
  10,
) || 15_000;

const UPCOMING_FRONTEND_BUFFER_MS = 5 * 60 * 1000;
const UPCOMING_FIXTURES_DAYS = 14;

/** Retry transient fixtures-by-date failures before surfacing an error. */
const FIXTURES_FETCH_MAX_ATTEMPTS = 3;
const FIXTURES_FETCH_RETRY_DELAYS_MS = [1500, 3000];

const SESSION_FIXTURES_PREFIX = "sokasport:fixtures-by-date:";

function sessionFixturesKey(dateStr) {
  return `${SESSION_FIXTURES_PREFIX}${dateStr}`;
}

function readSessionFixtures(dateStr) {
  try {
    const raw = sessionStorage.getItem(sessionFixturesKey(dateStr));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionFixtures(dateStr, rows) {
  try {
    sessionStorage.setItem(
      sessionFixturesKey(dateStr),
      JSON.stringify(Array.isArray(rows) ? rows : []),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const id = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortLike(e, signal) {
  if (signal?.aborted) return true;
  if (e?.name === "AbortError") {
    const timedOut =
      e?.name === "TimeoutError" ||
      String(e?.message || "")
        .toLowerCase()
        .includes("timed out");
    return !timedOut;
  }
  return false;
}

function matchesTimeFilter(matchDate, timeId) {
  if (!timeId || timeId === "all") return true;
  const date = parseUiDateToDate(matchDate);
  if (!date) return true;

  const now = new Date();
  const msDiff = date.getTime() - now.getTime();
  const hourMs = 60 * 60 * 1000;

  if (timeId === "1h") return msDiff >= 0 && msDiff <= hourMs;
  if (timeId === "3h") return msDiff >= 0 && msDiff <= 3 * hourMs;
  if (timeId === "12h") return msDiff >= 0 && msDiff <= 12 * hourMs;

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
  const dayOffset = Math.round((matchDay - today) / (24 * hourMs));

  if (timeId === "today") return dayOffset === 0;
  if (timeId === "tomorrow") return dayOffset === 1;
  const dayOffsetMatch = String(timeId).match(/^day(\d+)$/i);
  if (dayOffsetMatch) {
    return dayOffset === Number.parseInt(dayOffsetMatch[1], 10);
  }
  return true;
}

function isCalendarDayTimeId(id) {
  return (
    id === "today" || id === "tomorrow" || /^day\d+$/i.test(String(id || ""))
  );
}

export function useMatches({ includeLive = true, filters = {} } = {}) {
  const todayYmd = utcTodayYmd();
  const cachedToday = USE_FIXTURES_BY_DATE ? readSessionFixtures(todayYmd) : null;

  const [fixturesMap, setFixturesMap] = useState(() => {
    if (cachedToday) {
      return new Map([[todayYmd, cachedToday]]);
    }
    return new Map();
  });
  const [windowFixtures, setWindowFixtures] = useState([]);
  const [liveFixtures, setLiveFixtures] = useState([]);
  // Skip blocking spinner when we already have session-cached fixtures.
  const [loading, setLoading] = useState(() => !cachedToday);
  const [error, setError] = useState(null);
  const [oddsDetailByFixtureId, setOddsDetailByFixtureId] = useState(
    () => new Map(),
  );

  const fixturesRef = useRef({ prematch: [], live: [] });
  const oddsInflightRef = useRef(new Map());
  const oddsAbortByFixtureRef = useRef(new Map());
  const oddsDetailRef = useRef(oddsDetailByFixtureId);
  const loadedDatesRef = useRef(
    new Set(cachedToday ? [todayYmd] : []),
  );
  const prematchPollAbortRef = useRef(null);
  const prematchInitialAbortRef = useRef(null);
  // Allow refreshAll to revalidate a date that was hydrated from sessionStorage.
  const forceReloadDatesRef = useRef(new Set());
  const fixturesMapHasDataRef = useRef(Boolean(cachedToday));

  useEffect(() => {
    fixturesMapHasDataRef.current = fixturesMap.size > 0;
  }, [fixturesMap]);

  useEffect(() => {
    oddsDetailRef.current = oddsDetailByFixtureId;
  }, [oddsDetailByFixtureId]);

  const flatPrematchFixtures = useMemo(() => {
    if (USE_FIXTURES_BY_DATE) {
      const dates = [...fixturesMap.keys()].sort();
      const out = [];
      for (const d of dates) {
        const rows = fixturesMap.get(d);
        if (Array.isArray(rows)) out.push(...rows);
      }
      return out;
    }
    return windowFixtures;
  }, [fixturesMap, windowFixtures]);

  useEffect(() => {
    fixturesRef.current = {
      prematch: flatPrematchFixtures,
      live: liveFixtures,
    };
  }, [flatPrematchFixtures, liveFixtures]);

  const refreshWindowLegacy = useCallback(async (signal) => {
    const rows = await fetchFixturesUpcoming(UPCOMING_FIXTURES_DAYS, {
      signal,
    });
    setWindowFixtures(Array.isArray(rows) ? rows : []);
    setError(null);
  }, []);

  const refreshLoadedDates = useCallback(async (signal) => {
    const dates = [...loadedDatesRef.current].sort();
    if (!dates.length) return;

    const pairs = await Promise.all(
      dates.map(async (d) => {
        try {
          const rows = await fetchFixturesByDate(d, { signal });
          writeSessionFixtures(d, Array.isArray(rows) ? rows : []);
          return [d, Array.isArray(rows) ? rows : []];
        } catch {
          return null;
        }
      }),
    );

    if (signal?.aborted) return;

    const ok = pairs.filter(Boolean);
    if (!ok.length) return;

    setFixturesMap((prev) => {
      const next = new Map(prev);
      for (const [d, rows] of ok) {
        next.set(d, rows);
      }
      return next;
    });
    setError(null);
  }, []);

  const loadDateImpl = useCallback(async (dateStr, { signal, timeoutMs } = {}) => {
    if (!USE_FIXTURES_BY_DATE) return;
    const force = forceReloadDatesRef.current.has(dateStr);
    if (!force && loadedDatesRef.current.has(dateStr)) return;

    let lastError = null;
    for (let attempt = 0; attempt < FIXTURES_FETCH_MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) return;
      try {
        const rows = await fetchFixturesByDate(dateStr, { signal, timeoutMs });
        if (signal?.aborted) return;
        const safe = Array.isArray(rows) ? rows : [];
        loadedDatesRef.current.add(dateStr);
        forceReloadDatesRef.current.delete(dateStr);
        writeSessionFixtures(dateStr, safe);
        setFixturesMap((prev) => {
          const next = new Map(prev);
          next.set(dateStr, safe);
          return next;
        });
        setError(null);
        return;
      } catch (e) {
        if (isAbortLike(e, signal)) return;
        lastError = e;
        const delay = FIXTURES_FETCH_RETRY_DELAYS_MS[attempt];
        if (delay != null && attempt < FIXTURES_FETCH_MAX_ATTEMPTS - 1) {
          try {
            await sleep(delay, signal);
          } catch {
            return;
          }
        }
      }
    }

    // Final failure — do NOT mark the date loaded so Retry / filter change can refetch.
    const timedOut =
      lastError?.name === "TimeoutError" ||
      String(lastError?.message || "")
        .toLowerCase()
        .includes("timed out");
    setError(
      timedOut
        ? new Error("Matches took too long to load. Please try again.")
        : lastError,
    );
  }, []);

  const refreshLive = useCallback(async () => {
    if (!includeLive) return;
    try {
      const rows = await fetchFixturesLive();
      setLiveFixtures(Array.isArray(rows) ? rows : []);
    } catch {
      // Live polling failures should not kill the page.
    }
  }, [includeLive]);

  const refreshAll = useCallback(async () => {
    const hasCachedPaint =
      USE_FIXTURES_BY_DATE &&
      (loadedDatesRef.current.size > 0 || fixturesMapHasDataRef.current);
    // Only show the blocking spinner when we have nothing to paint.
    if (!hasCachedPaint) setLoading(true);
    prematchInitialAbortRef.current?.abort();
    const ac = new AbortController();
    prematchInitialAbortRef.current = ac;

    try {
      if (USE_FIXTURES_BY_DATE) {
        const today = utcTodayYmd();
        // Revalidate today even if sessionStorage hydrated it.
        forceReloadDatesRef.current.add(today);
        loadedDatesRef.current.delete(today);
        // Keep existing map for instant paint; loadDateImpl will overwrite.
        await loadDateImpl(today, {
          signal: ac.signal,
          timeoutMs: INITIAL_FIXTURES_TIMEOUT_MS,
        });
      } else {
        await refreshWindowLegacy(ac.signal);
      }
      refreshLive().catch(() => {});
    } catch (e) {
      if (e?.name !== "AbortError") setError(e);
    } finally {
      setLoading(false);
    }
  }, [loadDateImpl, refreshLive, refreshWindowLegacy]);

  useEffect(() => {
    return () => {
      prematchInitialAbortRef.current?.abort();
      prematchPollAbortRef.current?.abort();
      // Snapshot controllers at unmount — copy Map entries from latest ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional ref.current read in cleanup
      const oddsControllers = new Map(oddsAbortByFixtureRef.current);
      oddsControllers.forEach((c) => {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      refreshAll();
    }, 0);
    return () => clearTimeout(id);
  }, [refreshAll]);

  useEffect(() => {
    if (!USE_FIXTURES_BY_DATE || PREMATCH_POLL_MS <= 0) return undefined;

    const tick = () => {
      prematchPollAbortRef.current?.abort();
      const ac = new AbortController();
      prematchPollAbortRef.current = ac;
      refreshLoadedDates(ac.signal).catch(() => {});
    };

    const intervalId = setInterval(tick, PREMATCH_POLL_MS);
    return () => {
      clearInterval(intervalId);
      prematchPollAbortRef.current?.abort();
    };
  }, [refreshLoadedDates]);

  useEffect(() => {
    if (USE_FIXTURES_BY_DATE || PREMATCH_POLL_MS <= 0) return undefined;

    const tick = () => {
      prematchPollAbortRef.current?.abort();
      const ac = new AbortController();
      prematchPollAbortRef.current = ac;
      refreshWindowLegacy(ac.signal).catch(() => {});
    };

    const intervalId = setInterval(tick, PREMATCH_POLL_MS);
    return () => {
      clearInterval(intervalId);
      prematchPollAbortRef.current?.abort();
    };
  }, [refreshWindowLegacy]);

  useEffect(() => {
    if (!includeLive) return undefined;
    const t = setInterval(refreshLive, 10_000);
    return () => clearInterval(t);
  }, [includeLive, refreshLive]);

  useEffect(() => {
    if (!USE_FIXTURES_BY_DATE) return undefined;

    const off = calendarTimeIdToUtcDayOffset(filters.timeId);
    if (off === null) return undefined;
    if (off < 0 || off >= MAX_PREMATCH_DAYS) return undefined;

    const ymd = addUtcDaysYmd(utcTodayYmd(), off);
    if (fixturesMap.has(ymd)) return undefined;

    void loadDateImpl(ymd);

    return undefined;
  }, [filters.timeId, fixturesMap, loadDateImpl]);

  const matches = useMemo(() => {
    const byFixtureId = new Map();
    const cutoff = Date.now() + UPCOMING_FRONTEND_BUFFER_MS;
    const isFutureKickoff = (fixture) => {
      const ts = new Date(fixture?.start_time).getTime();
      return Number.isFinite(ts) && ts > cutoff;
    };

    for (const fx of flatPrematchFixtures) {
      if (!isFutureKickoff(fx)) continue;
      byFixtureId.set(fx.api_fixture_id, mapFixtureToMatch(fx));
    }

    for (const live of liveFixtures) {
      if (!isFutureKickoff(live)) continue;
      byFixtureId.set(live.api_fixture_id, mapFixtureToMatch(live));
    }

    return Array.from(byFixtureId.values()).sort((a, b) => {
      const dr = (a.leagueRank ?? 9999) - (b.leagueRank ?? 9999);
      if (dr !== 0) return dr;
      const ka = a.kickoffAt ? new Date(a.kickoffAt).getTime() : 0;
      const kb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : 0;
      return ka - kb || Number(a.apiFixtureId) - Number(b.apiFixtureId);
    });
  }, [flatPrematchFixtures, liveFixtures]);

  const hydrateMatchOdds = useCallback(async (apiFixtureId) => {
    const id = Number(apiFixtureId);
    if (!Number.isFinite(id)) return;

    const existing = oddsDetailRef.current.get(id);
    if (existing != null && typeof existing === "object") return;

    const inflight = oddsInflightRef.current.get(id);
    if (inflight) return inflight;

    const run = (async () => {
      oddsAbortByFixtureRef.current.get(id)?.abort();
      const ac = new AbortController();
      oddsAbortByFixtureRef.current.set(id, ac);

      try {
        const payload = await fetchOddsForFixture(id, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setOddsDetailByFixtureId((prev) => new Map(prev).set(id, payload));
      } catch (e) {
        if (e?.name === "AbortError") return;
        setOddsDetailByFixtureId((prev) => new Map(prev).set(id, null));
      } finally {
        oddsAbortByFixtureRef.current.delete(id);
      }
    })();

    oddsInflightRef.current.set(id, run);
    await run;
    oddsInflightRef.current.delete(id);
  }, []);

  const hydratedMatches = useMemo(
    () =>
      matches.map((m) => {
        const detail = oddsDetailByFixtureId.get(m.apiFixtureId);
        if (!detail || typeof detail !== "object") return m;
        return applyOddsToMatch(m, detail);
      }),
    [matches, oddsDetailByFixtureId],
  );

  const { resolvedTimeId, dateDropdownOptions } = useMemo(() => {
    const selSport = String(filters.sportId || "").toLowerCase();
    const base = hydratedMatches.filter((match) => {
      const sportId = String(match.sportId || "").toLowerCase();
      if (selSport && sportId && sportId !== selSport) return false;
      if (
        filters.leagueId &&
        filters.leagueId !== "all-leagues" &&
        match.league !== filters.leagueId
      ) {
        return false;
      }
      return true;
    });

    const maxDayOffset = USE_FIXTURES_BY_DATE ? MAX_PREMATCH_DAYS - 1 : 4;

    const counts = new Map();
    for (const m of base) {
      const off = getCalendarDayOffset(m.date);
      if (off === null || off < 0 || off > maxDayOffset) continue;
      counts.set(off, (counts.get(off) || 0) + 1);
    }

    const optionById = new Map(
      buildSportsbookTimeOptions(undefined, MAX_PREMATCH_DAYS).map((t) => [
        t.id,
        t,
      ]),
    );
    const dateDropdownOptions = [];
    for (let off = 0; off <= maxDayOffset; off += 1) {
      const n = counts.get(off);
      if (!n) continue;
      const tid = dayOffsetToTimeId(off);
      if (!tid) continue;
      const meta = optionById.get(tid);
      dateDropdownOptions.push({
        id: tid,
        label: meta?.label ?? tid,
        labelKey: meta?.labelKey ?? null,
        count: n,
      });
    }

    const dayIds = new Set(dateDropdownOptions.map((o) => o.id));
    const hourIds = new Set(["1h", "3h", "12h"]);
    const tid = filters.timeId;
    let resolvedTimeId = tid;

    if (dayIds.size === 0) {
      resolvedTimeId = tid;
    } else if (hourIds.has(tid)) {
      resolvedTimeId = tid;
    } else if (isCalendarDayTimeId(tid)) {
      resolvedTimeId = dayIds.has(tid) ? tid : dateDropdownOptions[0].id;
    }

    return { resolvedTimeId, dateDropdownOptions };
  }, [hydratedMatches, filters.sportId, filters.leagueId, filters.timeId]);

  const filteredMatches = useMemo(
    () =>
      hydratedMatches.filter((match) => {
        const sportId = String(match.sportId || "").toLowerCase();
        const selectedSport = String(filters.sportId || "").toLowerCase();
        if (selectedSport && sportId && sportId !== selectedSport) return false;
        if (
          filters.leagueId &&
          filters.leagueId !== "all-leagues" &&
          match.league !== filters.leagueId
        ) {
          return false;
        }

        const q = String(filters.clubSearch || "").trim();
        if (q) {
          return matchesClubNameSearch(match, q);
        }
        if (!matchesTimeFilter(match.date, resolvedTimeId)) return false;
        return true;
      }),
    [
      filters.clubSearch,
      filters.leagueId,
      filters.sportId,
      hydratedMatches,
      resolvedTimeId,
    ],
  );

  return {
    allMatches: hydratedMatches,
    matches: filteredMatches,
    resolvedTimeId,
    dateDropdownOptions,
    loading,
    error,
    refreshAll,
    hydrateMatchOdds,
    oddsDetailByFixtureId,
    maxPrematchDays: MAX_PREMATCH_DAYS,
    fixturesByDateMode: USE_FIXTURES_BY_DATE,
  };
}

export default useMatches;
