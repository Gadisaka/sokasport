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
import { sortMatchesForDisplay } from "../utils/matchDisplaySort";
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

const UPCOMING_FRONTEND_BUFFER_MS = 5 * 60 * 1000;
const UPCOMING_FIXTURES_DAYS = 14;

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
  const [fixturesMap, setFixturesMap] = useState(() => new Map());
  const [windowFixtures, setWindowFixtures] = useState([]);
  const [liveFixtures, setLiveFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [oddsDetailByFixtureId, setOddsDetailByFixtureId] = useState(
    () => new Map(),
  );

  const fixturesRef = useRef({ prematch: [], live: [] });
  const oddsInflightRef = useRef(new Map());
  const oddsAbortByFixtureRef = useRef(new Map());
  const oddsDetailRef = useRef(oddsDetailByFixtureId);
  const loadedDatesRef = useRef(new Set());
  const prematchPollAbortRef = useRef(null);
  const prematchInitialAbortRef = useRef(null);

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
        const rows = await fetchFixturesByDate(d, { signal });
        return [d, Array.isArray(rows) ? rows : []];
      }),
    );

    if (signal?.aborted) return;

    setFixturesMap((prev) => {
      const next = new Map(prev);
      for (const [d, rows] of pairs) {
        next.set(d, rows);
      }
      return next;
    });
    setError(null);
  }, []);

  const loadDateImpl = useCallback(async (dateStr, { signal } = {}) => {
    if (!USE_FIXTURES_BY_DATE) return;
    if (loadedDatesRef.current.has(dateStr)) return;

    try {
      const rows = await fetchFixturesByDate(dateStr, { signal });
      if (signal?.aborted) return;
      loadedDatesRef.current.add(dateStr);
      setFixturesMap((prev) => {
        const next = new Map(prev);
        next.set(dateStr, Array.isArray(rows) ? rows : []);
        return next;
      });
      setError(null);
    } catch (e) {
      if (e?.name !== "AbortError") {
        setError(e);
        loadedDatesRef.current.add(dateStr);
        setFixturesMap((prev) => {
          const next = new Map(prev);
          if (!next.has(dateStr)) next.set(dateStr, []);
          return next;
        });
      }
    }
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
    setLoading(true);
    prematchInitialAbortRef.current?.abort();
    const ac = new AbortController();
    prematchInitialAbortRef.current = ac;

    try {
      if (USE_FIXTURES_BY_DATE) {
        loadedDatesRef.current.clear();
        setFixturesMap(new Map());
        await loadDateImpl(utcTodayYmd(), { signal: ac.signal });
      } else {
        await refreshWindowLegacy(ac.signal);
      }
      setError(null);
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

    return sortMatchesForDisplay(Array.from(byFixtureId.values()));
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
