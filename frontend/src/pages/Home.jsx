import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "../components/layout/MainLayout";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import PageContainer from "../components/layout/PageContainer";
import PrimaryNav from "../components/layout/PrimaryNav";
import TopHeader from "../components/layout/TopHeader";
import BetSlipPanel from "../components/sections/BetSlipPanel";
import HeroBanner from "../components/sections/HeroBanner";
import MatchesTable from "../components/sections/MatchesTable";
import MatchesTabs from "../components/sections/MatchesTabs";
import NextCalendarDayFooter from "../components/sections/NextCalendarDayFooter";
import SportsSidebar from "../components/sections/SportsSidebar";
import TopLeaguesSidebar from "../components/sections/TopLeaguesSidebar";
import {
  sportsList,
  sportsbookToolbar,
  topHeaderData,
  topNavItems,
} from "../data/homepageData";
import useMatches, { PREMATCH_HORIZON_DAYS } from "../hooks/useMatches";
import { useFootballSidebarCatalog } from "../hooks/useFootballSidebarCatalog";
import {
  buildLeagueSidebarGroups,
  buildLeagueTabOptions,
} from "../utils/buildLeagueSidebarGroups";
import { buildSportsbookTimeOptions } from "../utils/sportsbookTimeOptions";
import {
  enrichSlipsFromMatches,
  loadBetSlipState,
  persistBetSlipState,
  BET_SLIP_STATE_EVENT,
} from "../utils/betSlipPersistence";
import { usePlayerSiteBranding } from "../hooks/usePlayerSiteBranding";

/** History keys for SPA back handling on Home (fixture expand + scroll). */
const HISTORY_HOME_FIXTURE = "__home_fixture_drop";
const HISTORY_HOME_SCROLL_PIN = "__home_scroll_pin";
const SCROLL_PIN_THRESHOLD_PX = 56;

function Home() {
  const initialBet = loadBetSlipState();
  const { loadingLogo } = usePlayerSiteBranding();
  const defaultSportId = sportsbookToolbar.sports?.[0]?.id || "football";
  const allLeaguesId = "all-leagues";

  const timeOptions = useMemo(
    () => buildSportsbookTimeOptions(undefined, PREMATCH_HORIZON_DAYS),
    [],
  );
  const defaultTimeId =
    timeOptions.find((time) => time.id === "today")?.id || "today";

  const [selectedSportId, setSelectedSportId] = useState(defaultSportId);
  const [selectedTimeId, setSelectedTimeId] = useState(defaultTimeId);
  const [selectedLeagueId, setSelectedLeagueId] = useState(allLeaguesId);
  const [clubSearch, setClubSearch] = useState("");
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [activeSlip, setActiveSlip] = useState(initialBet.activeSlip);
  const [slips, setSlips] = useState(initialBet.slips);
  const selectedOdds = useMemo(
    () => new Set((slips[activeSlip] || []).map((selection) => selection.id)),
    [activeSlip, slips],
  );

  const {
    matches,
    allMatches,
    loading,
    hydrateMatchOdds,
    oddsDetailByFixtureId,
    resolvedTimeId,
    dateDropdownOptions,
  } = useMatches({
    includeLive: true,
    filters: {
      sportId: selectedSportId,
      timeId: selectedTimeId,
      leagueId: selectedLeagueId,
      clubSearch,
    },
  });

  const { catalogItems } = useFootballSidebarCatalog();

  const selections = slips[activeSlip];

  const expandedMatchIdRef = useRef(expandedMatchId);
  useEffect(() => {
    expandedMatchIdRef.current = expandedMatchId;
  }, [expandedMatchId]);

  const ignoreNextPopRef = useRef(false);
  const fixtureClosedByPopRef = useRef(false);
  const prevExpandedMatchIdRef = useRef(expandedMatchId);
  const scrollPinActiveRef = useRef(false);

  // Push/sync history entries when a fixture row opens, closes, or switches.
  useEffect(() => {
    const prev = prevExpandedMatchIdRef.current;
    const curr = expandedMatchId;

    if (curr && !prev) {
      const s = window.history.state || {};
      window.history.pushState({ ...s, [HISTORY_HOME_FIXTURE]: true }, "");
    } else if (!curr && prev) {
      if (fixtureClosedByPopRef.current) {
        fixtureClosedByPopRef.current = false;
      } else {
        ignoreNextPopRef.current = true;
        window.history.go(-1);
      }
    } else if (curr && prev && curr !== prev) {
      const s = window.history.state || {};
      window.history.replaceState({ ...s, [HISTORY_HOME_FIXTURE]: true }, "");
    }

    prevExpandedMatchIdRef.current = curr;
  }, [expandedMatchId]);

  // When scrolled down without an open fixture, add a stack entry so Back scrolls up first.
  useEffect(() => {
    let rafId = null;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (expandedMatchIdRef.current) return;
        const y =
          window.scrollY ||
          document.documentElement.scrollTop ||
          window.pageYOffset ||
          0;
        if (y <= SCROLL_PIN_THRESHOLD_PX) return;
        if (scrollPinActiveRef.current) return;
        scrollPinActiveRef.current = true;
        const s = window.history.state || {};
        window.history.pushState({ ...s, [HISTORY_HOME_SCROLL_PIN]: true }, "");
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }

      if (expandedMatchIdRef.current) {
        fixtureClosedByPopRef.current = true;
        expandedMatchIdRef.current = null;
        setExpandedMatchId(null);
        return;
      }

      if (!scrollPinActiveRef.current) {
        return;
      }

      scrollPinActiveRef.current = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- enrich persisted slips when fixture metadata refreshes
    setSlips((prev) => enrichSlipsFromMatches(prev, allMatches));
  }, [allMatches]);

  useEffect(() => {
    persistBetSlipState(slips, activeSlip);
  }, [slips, activeSlip]);

  useEffect(() => {
    const onSlipSync = () => {
      const { slips: nextSlips, activeSlip: nextActive } = loadBetSlipState();
      setSlips(nextSlips);
      setActiveSlip(nextActive);
    };
    window.addEventListener(BET_SLIP_STATE_EVENT, onSlipSync);
    return () => window.removeEventListener(BET_SLIP_STATE_EVENT, onSlipSync);
  }, []);

  const handleMatchClick = useCallback(
    async (match) => {
      setExpandedMatchId((prev) => (prev === match.id ? null : match.id));
      if (!match?.apiFixtureId) return;
      try {
        await hydrateMatchOdds(match.apiFixtureId);
      } catch (err) {
        console.error("Failed to hydrate match odds:", err);
      }
    },
    [hydrateMatchOdds],
  );

  const handleOddsClick = useCallback(
    (oddData) => {
      setSlips((prev) => {
        const current = prev[activeSlip];
        const exists = current.find((s) => s.id === oddData.id);
        if (exists) {
          return {
            ...prev,
            [activeSlip]: current.filter((s) => s.id !== oddData.id),
          };
        }
        const withoutSameMatch = current.filter(
          (s) => s.matchName !== oddData.matchName,
        );
        return {
          ...prev,
          [activeSlip]: [...withoutSameMatch, oddData],
        };
      });
    },
    [activeSlip],
  );

  const handleRemoveSelection = useCallback(
    (id) => {
      setSlips((prev) => ({
        ...prev,
        [activeSlip]: prev[activeSlip].filter((s) => s.id !== id),
      }));
    },
    [activeSlip],
  );

  const handleClearSelections = useCallback(() => {
    setSlips((prev) => ({
      ...prev,
      [activeSlip]: [],
    }));
  }, [activeSlip]);

  const handleReplaceSlipSelections = useCallback(
    (nextSelections) => {
      setSlips((prev) => ({
        ...prev,
        [activeSlip]: Array.isArray(nextSelections) ? nextSelections : [],
      }));
    },
    [activeSlip],
  );

  const sportCounts = useMemo(() => {
    const counts = new Map();
    allMatches.forEach((match) => {
      const key = String(match.sportId || "").toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [allMatches]);

  const toolbarSports = useMemo(
    () =>
      sportsbookToolbar.sports.map((sport) => ({
        id: sport.id,
        label: sport.label,
        icon: sport.icon,
        count: sportCounts.get(String(sport.id || "").toLowerCase()) || 0,
      })),
    [sportCounts],
  );

  const sidebarSports = useMemo(
    () =>
      sportsList.map((sport) => {
        const dynamicCount = sportCounts.get(
          String(sport.id || "").toLowerCase(),
        );
        return {
          ...sport,
          count: Number.isFinite(dynamicCount) ? dynamicCount : sport.count,
        };
      }),
    [sportCounts],
  );

  const leagueCounts = useMemo(() => {
    const counts = new Map();
    allMatches.forEach((match) => {
      const id = String(match.league || "").trim();
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    return counts;
  }, [allMatches]);

  const leagueMetaByKey = useMemo(() => {
    const m = new Map();
    allMatches.forEach((match) => {
      const id = String(match.league || "").trim();
      if (!id || m.has(id)) return;
      m.set(id, {
        leagueLogo: match.leagueLogo || null,
        countryFlag: match.countryFlag || null,
      });
    });
    return m;
  }, [allMatches]);

  const leagueOptions = useMemo(
    () =>
      buildLeagueTabOptions({
        allLeaguesId,
        allMatchesLength: allMatches.length,
        catalogItems,
        counts: leagueCounts,
        leagueMetaByKey,
      }),
    [
      allLeaguesId,
      allMatches.length,
      catalogItems,
      leagueCounts,
      leagueMetaByKey,
    ],
  );

  const { regionGroups, countryGroups } = useMemo(
    () => buildLeagueSidebarGroups(catalogItems, leagueCounts, leagueMetaByKey),
    [catalogItems, leagueCounts, leagueMetaByKey],
  );

  const totalLeagueCount = Math.max(leagueOptions.length - 1, 0);

  const topLeaguesSidebarProps = useMemo(
    () => ({
      regionGroups,
      countryGroups,
      allLeaguesId,
      totalLeagueCount,
      selectedLeagueId,
      onSelectLeague: setSelectedLeagueId,
      selectedTimeId: resolvedTimeId,
      onTimeChange: setSelectedTimeId,
      timeOptions,
      dateDropdownOptions,
      searchQuery: clubSearch,
      onSearchChange: setClubSearch,
    }),
    [
      regionGroups,
      countryGroups,
      allLeaguesId,
      totalLeagueCount,
      selectedLeagueId,
      resolvedTimeId,
      timeOptions,
      dateDropdownOptions,
      clubSearch,
    ],
  );

  const handleNextCalendarDay = useCallback((timeId) => {
    setSelectedTimeId(timeId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute left-1/2 top-[-1rem] h-80 w-[min(100%,56rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.1),transparent_68%)] blur-2xl"
          aria-hidden
        />
        <MainLayout
          left={
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                <TopLeaguesSidebar {...topLeaguesSidebarProps} />
              </div>
              <SportsSidebar
                sports={sidebarSports}
                selectedSportId={selectedSportId}
                onSportChange={setSelectedSportId}
              />
            </>
          }
          center={
            <>
              <div className="hidden gap-2 md:grid lg:hidden md:grid-cols-2">
                <TopLeaguesSidebar {...topLeaguesSidebarProps} />
                <SportsSidebar
                  sports={sidebarSports}
                  selectedSportId={selectedSportId}
                  onSportChange={setSelectedSportId}
                />
              </div>
              <HeroBanner />
              <MatchesTabs
                sports={toolbarSports}
                times={timeOptions}
                leagues={leagueOptions}
                selectedSportId={selectedSportId}
                selectedTimeId={resolvedTimeId}
                selectedLeagueId={selectedLeagueId}
                onSportChange={setSelectedSportId}
                onTimeChange={setSelectedTimeId}
                onLeagueChange={setSelectedLeagueId}
                searchQuery={clubSearch}
                onSearchChange={setClubSearch}
              />
              <MatchesTable
                matches={matches}
                onMatchClick={handleMatchClick}
                onOddsClick={handleOddsClick}
                selectedOdds={selectedOdds}
                expandedMatchId={expandedMatchId}
                oddsDetailByFixtureId={oddsDetailByFixtureId}
              />
              {!loading && !String(clubSearch).trim() ? (
                <NextCalendarDayFooter
                  resolvedTimeId={resolvedTimeId}
                  timeOptions={timeOptions}
                  horizonDays={PREMATCH_HORIZON_DAYS}
                  onSelectDay={handleNextCalendarDay}
                />
              ) : null}
            </>
          }
          right={
            <BetSlipPanel
              selections={selections}
              onRemoveSelection={handleRemoveSelection}
              onClearSelections={handleClearSelections}
              onReplaceSelections={handleReplaceSlipSelections}
              activeSlip={activeSlip}
              onChangeSlip={setActiveSlip}
            />
          }
        />
      </div>
      {loading ? (
        <div
          className="pointer-events-auto fixed inset-0 z-80 flex items-center justify-center bg-black/35 backdrop-blur-md"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label="Loading"
        >
          <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
            <div className="absolute h-52 w-52 animate-pulse rounded-full bg-[#019052]/30 blur-3xl sm:h-56 sm:w-56" />
            <div className="absolute h-36 w-36 animate-ping rounded-full border border-[#019052]/55" />
            <div className="absolute h-28 w-28 animate-spin rounded-full border-2 border-transparent border-t-[#019052] border-r-[#019052]/35 sm:h-32 sm:w-32" />
            <img
              src={loadingLogo}
              alt=""
              decoding="async"
              className="relative z-10 h-[min(7.5rem,42vmin)] w-[min(7.5rem,42vmin)] object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] sm:h-[min(8.5rem,38vmin)] sm:w-[min(8.5rem,38vmin)]"
            />
          </div>
        </div>
      ) : null}
      {/* <SiteFooter /> */}
      <MobileBottomBar
        useParentSlip
        selections={selections}
        onRemoveSelection={handleRemoveSelection}
        onClearSelections={handleClearSelections}
        onReplaceSelections={handleReplaceSlipSelections}
      />
    </PageContainer>
  );
}

export default Home;
