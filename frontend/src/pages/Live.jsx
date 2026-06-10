import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppIcon from "../components/common/AppIcon";
import ExpansionMarketSection from "../components/common/ExpansionMarketSection";
import LogoImg from "../components/common/LogoImg";
import OddsCell from "../components/common/OddsCell";
import MainLayout from "../components/layout/MainLayout";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import PageContainer from "../components/layout/PageContainer";
import PrimaryNav from "../components/layout/PrimaryNav";
import TopHeader from "../components/layout/TopHeader";
import BetSlipPanel from "../components/sections/BetSlipPanel";
import SportsSidebar from "../components/sections/SportsSidebar";
import TopLeaguesSidebar from "../components/sections/TopLeaguesSidebar";
import { topHeaderData, topNavItems, sportsList } from "../data/homepageData";
import { fetchFixturesLive, fetchLiveOdds } from "../services/api";
import { mapFixtureToMatch } from "../services/fixtureMapper";
import { sortMatchesForDisplay } from "../utils/matchDisplaySort";
import {
  clampSelectionsToMax,
  slipCountsFromSlips,
  toggleSlipSelection,
} from "../utils/betSlipLimits";
import { normalizeApiFixtureId } from "../utils/fixtureId";
import { resolveCompactMarketToken } from "../utils/compactMarketToken";
import {
  MARKET_FILTER_CHIPS,
  MARKET_FILTER_ALL_CHIP_ID,
  filterCategoriesByChipId,
} from "../data/footballMarketsByCategory";
import { buildLeagueSidebarGroups } from "../utils/buildLeagueSidebarGroups";
import { useFootballSidebarCatalog } from "../hooks/useFootballSidebarCatalog";
import {
  enrichSlipsFromMatches,
  loadBetSlipState,
  persistBetSlipState,
  BET_SLIP_STATE_EVENT,
} from "../utils/betSlipPersistence";

const LIVE_REFRESH_MS = 10_000;
const LIVE_MARKETS = ["1", "x", "2"];

/** Interval / clock-slice markets (not full-match 1X2). */
function isLiveOddsWindowOrIntervalMarket(nameRaw) {
  const n = String(nameRaw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;

  if (
    /\b\d{1,3}\s*(min|mins|minute|minutes)\b/.test(n) ||
    /\bin\s+\d{1,3}\s*(min|mins|minute|minutes)\b/.test(n) ||
    /\b(from|until|next)\s+\d{1,3}(\s*(min|mins|minute|minutes))?\b/.test(n) ||
    /\b\d{1,2}\s*['′]/.test(n) ||
    /\b1x2\b.*[-–—]\s*\d/.test(n) ||
    /\b1x2\b.*\b\d{1,3}\s*(min|mins)\b/.test(n)
  ) {
    return true;
  }

  if (
    /\b(first|1st|second|2nd)\s+half\b/.test(n) ||
    /\bhalf\s*time\b(?!\s*full\b)/.test(n) ||
    /\b15\s*minutes\b|\b10\s*minutes\b|\b30\s*minutes\b|\b40\s*minutes\b|\b45\s*minutes\b|\b60\s*minutes\b/.test(
      n,
    )
  ) {
    return true;
  }

  return false;
}

/** Full-match 1X2 only (excludes "1X2 - 15 minutes", "1x2 in 40 minutes", etc.). */
function isLiveThreeWayResultMarket(nameRaw) {
  if (isLiveOddsWindowOrIntervalMarket(nameRaw)) return false;

  const trimmed = String(nameRaw || "").trim();
  const n = trimmed.toLowerCase().replace(/\s+/g, " ");

  if (/\b(first|1st|second|2nd)\s+half\b/.test(n)) return false;
  if (/\bhalf\s*time\b/.test(n) && !/full\s*time/.test(n)) return false;

  if (
    n.includes("match winner") ||
    n.includes("fulltime result") ||
    n.includes("full time result") ||
    (n.includes("full") && n.includes("result") && !n.includes("half")) ||
    n === "match result"
  ) {
    return true;
  }

  return /^1x2$/i.test(trimmed);
}

function isLiveDoubleChanceMarket(nameRaw) {
  if (isLiveOddsWindowOrIntervalMarket(nameRaw)) return false;
  return String(nameRaw || "")
    .toLowerCase()
    .includes("double chance");
}

function isLiveMainMarketCategory(nameRaw) {
  return (
    isLiveThreeWayResultMarket(nameRaw) || isLiveDoubleChanceMarket(nameRaw)
  );
}

/** Higher = better source for the compact 1 / X / 2 row. */
function liveThreeWayMarketPriority(nameRaw) {
  if (!isLiveThreeWayResultMarket(nameRaw)) return -1;
  const n = String(nameRaw || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (n.includes("match winner")) return 100;
  if (n.includes("full time result") || n.includes("fulltime result"))
    return 90;
  if (n === "match result") return 80;
  if (/^1x2$/i.test(String(nameRaw || "").trim())) return 75;
  if (n.includes("full") && n.includes("result")) return 70;
  return 50;
}

function splitMatchTeams(matchName) {
  const [home = "Home", away = "Away"] = String(matchName || "").split(" V ");
  return { home, away };
}

function formatLeagueLabel(league) {
  const [zone, name] = String(league || "").split(" - ");
  if (!name) return zone || "";
  return `${zone} · ${name}`;
}

function matchHasExpansionCategories(match) {
  const d = match?.detailedOdds;
  return (
    (Array.isArray(d?.main) && d.main.length > 0) ||
    (Array.isArray(d?.extra) && d.extra.length > 0)
  );
}

function LiveIndicator() {
  return (
    <span className="relative mr-1.5 inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

function LiveExpansionEmpty({ onClose }) {
  return (
    <div className="border-t border-white/8 bg-gradient-to-b from-(--sb-bg-page)/98 to-(--sb-accent-surface-deep)/98">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <span className="text-[11px] font-semibold text-[#7f89a4]">
          Live Match
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-(--sb-bg-2) hover:ring-1 hover:ring-(--sb-accent-fill)/25"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>
      <p className="px-3 py-8 text-center text-sm text-[#7f89a4]">
        No odds available for this match yet.
      </p>
    </div>
  );
}

function LiveExpansion({ match, onClose, onOddsClick, selectedOdds }) {
  const handleOddsInExpansion = useCallback(
    (payload) => {
      onOddsClick?.(payload);
      onClose();
    },
    [onOddsClick, onClose],
  );

  const [activeChipId, setActiveChipId] = useState(MARKET_FILTER_ALL_CHIP_ID);
  const detail = match.detailedOdds;
  const categories = [...(detail?.main || []), ...(detail?.extra || [])];
  const filteredCategories = filterCategoriesByChipId(categories, activeChipId);
  const showFilteredEmpty =
    activeChipId !== MARKET_FILTER_ALL_CHIP_ID &&
    filteredCategories.length === 0;
  const visibleCategories = filteredCategories;
  const { home, away } = splitMatchTeams(match.match);

  if (!categories.length) {
    return <LiveExpansionEmpty onClose={onClose} />;
  }

  return (
    <div className="border-t border-white/8 bg-gradient-to-b from-(--sb-bg-page)/98 to-(--sb-accent-surface-deep)/98">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#7f89a4]">
          {match.countryFlag ? (
            <LogoImg
              src={match.countryFlag}
              alt=""
              size={18}
              rounded="rounded-[2px]"
              className="border border-transparent"
            />
          ) : null}
          {match.leagueLogo ? (
            <LogoImg
              src={match.leagueLogo}
              alt=""
              size={20}
              className="border border-transparent bg-(--sb-bg-page)"
            />
          ) : null}
          <span className="truncate">{formatLeagueLabel(match.league)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-(--sb-bg-2) hover:ring-1 hover:ring-(--sb-accent-fill)/25"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 bg-(--sb-bg-page)/90 px-3 py-3">
        <div className="mb-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-[#ef4444]">
          <LiveIndicator />
          {match.elapsedSeconds ||
            (match.elapsed != null ? `${match.elapsed}'` : "Live")}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-transparent bg-(--sb-bg-2)">
              {match.homeTeamLogo ? (
                <LogoImg
                  src={match.homeTeamLogo}
                  alt=""
                  size={36}
                  className="h-9 w-9 max-w-none rounded-full object-cover"
                  rounded="rounded-full"
                />
              ) : (
                <AppIcon name="flag" size={14} className="text-[#dce4ff]" />
              )}
            </div>
            <div className="text-xs font-semibold text-[#edf1ff]">{home}</div>
            <div className="text-lg font-bold text-[#ef4444]">
              {match.homeScore ?? 0}
            </div>
          </div>
          <div className="text-xs font-semibold tracking-wider text-[#91a0c8]">
            VS
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-transparent bg-(--sb-bg-2)">
              {match.awayTeamLogo ? (
                <LogoImg
                  src={match.awayTeamLogo}
                  alt=""
                  size={36}
                  className="h-9 w-9 max-w-none rounded-full object-cover"
                  rounded="rounded-full"
                />
              ) : (
                <AppIcon name="flag" size={14} className="text-[#dce4ff]" />
              )}
            </div>
            <div className="text-xs font-semibold text-[#edf1ff]">{away}</div>
            <div className="text-lg font-bold text-[#ef4444]">
              {match.awayScore ?? 0}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/8 px-3 py-2">
        {MARKET_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setActiveChipId(chip.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              chip.id === activeChipId
                ? "border-(--sb-accent) bg-(--sb-accent-surface) text-(--sb-accent-text-soft)"
                : "border-[#2f3047] bg-[#131a2c] text-[rgba(255,255,255,0.72)]"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 p-2.5">
        {showFilteredEmpty ? (
          <p className="rounded border border-[#293047] bg-[#0e1528] px-3 py-8 text-center text-xs text-[#7f89a4]">
            No markets in this category for this match.
          </p>
        ) : null}
        {!showFilteredEmpty
          ? visibleCategories.map((category) => (
              <ExpansionMarketSection
                key={category.category}
                marketLabel={category.category}
                odds={category.odds}
                matchName={match.match}
                apiFixtureId={match.apiFixtureId}
                kickoffAt={match.kickoffAt}
                matchStatus={match.liveStatus ?? match.status}
                fromLive
                onOddsClick={handleOddsInExpansion}
                selectedOdds={selectedOdds}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function LiveOddButton({ value, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[36px] w-full items-center justify-center rounded-xl border text-[13px] font-semibold transition-all duration-200 ${
        selected
          ? "border-(--sb-accent) bg-(--sb-accent-surface-deep) text-(--sb-accent-text-muted) shadow-[0_0_12px_rgba(1,144,82,0.35)]"
          : "border-transparent bg-(--sb-bg-page) text-[#ffffff] hover:bg-(--sb-bg-2)"
      }`.trim()}
    >
      {value ?? "-"}
    </button>
  );
}

function LiveRow({ match, isExpanded, onToggle, onOddsClick, selectedOdds }) {
  const { home, away } = splitMatchTeams(match.match);
  const summaryMap = useMemo(
    () =>
      (match.markets || []).reduce((acc, market) => {
        acc[String(market.id || "").toLowerCase()] = market.value;
        return acc;
      }, {}),
    [match.markets],
  );

  const statusLabel = String(
    match.liveStatus || match.status || "LIVE",
  ).toUpperCase();

  let statusText = "Live";
  if (
    statusLabel === "HT" ||
    statusLabel.includes("HALF TIME") ||
    statusLabel.includes("HALFTIME")
  ) {
    statusText = "HT";
  } else if (statusLabel === "PEN" || statusLabel.includes("PENALT")) {
    statusText = "PEN";
  } else if (statusLabel.includes("EXTRA TIME") || statusLabel.includes("ET")) {
    statusText =
      match.elapsedSeconds ||
      (match.elapsed != null ? `ET ${match.elapsed}'` : "ET");
  } else if (
    statusLabel.includes("FIRST HALF") ||
    statusLabel.includes("SECOND HALF")
  ) {
    statusText =
      match.elapsedSeconds ||
      (match.elapsed != null ? `${match.elapsed}'` : "Live");
  } else if (match.elapsedSeconds) {
    statusText = match.elapsedSeconds;
  } else if (match.elapsed != null) {
    statusText = `${match.elapsed}'`;
  }

  return (
    <article
      className={`border-b border-white/8 transition-all duration-300 last:border-b-0 ${
        isExpanded
          ? "bg-(--sb-accent-surface-deep)/60 ring-1 ring-(--sb-accent-fill)/45 shadow-[0_8px_28px_-8px_rgba(1,144,82,0.22)]"
          : "hover:bg-(--sb-accent-surface-deep)/35"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer px-3 py-2.5 transition-colors"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px_72px] items-center gap-2 max-md:grid-cols-1">
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center truncate text-[11px] text-[rgba(255,255,255,0.72)]">
              {String(match.league || "").replace(" - ", " • ")}
            </div>
            <div className="space-y-0.5 text-[13px] leading-tight">
              <div className="flex items-center gap-1.5 truncate font-semibold text-[#f6f9ff]">
                <span className="min-w-[14px] text-[#ef4444]">
                  {match.homeScore ?? 0}
                </span>
                <span className="truncate">{home}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate font-semibold text-[#d0d8ed]">
                <span className="min-w-[14px] text-[#ef4444]">
                  {match.awayScore ?? 0}
                </span>
                <span className="truncate">{away}</span>
              </div>
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-[#22c55e]">
              +{match.sideBets || 0} Markets
            </div>
          </div>

          {LIVE_MARKETS.map((marketId) => {
            const value = summaryMap[marketId];
            const selectionId = `${match.match}-${marketId.toUpperCase()}`;
            return (
              <div key={marketId} className="max-md:hidden">
                <LiveOddButton
                  value={value}
                  selected={selectedOdds?.has(selectionId)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!value) return;
                    onOddsClick?.({
                      id: selectionId,
                      apiFixtureId: match.apiFixtureId,
                      matchName: match.match,
                      ...resolveCompactMarketToken(marketId),
                      value,
                      kickoffAt: match.kickoffAt,
                      matchStatus: match.liveStatus ?? match.status,
                      fromLive: true,
                    });
                  }}
                />
              </div>
            );
          })}

          <div className="flex flex-col items-end justify-center gap-0.5 max-md:hidden">
            <div className="flex items-center text-[10px] font-semibold text-[#ef4444]">
              <LiveIndicator />
              {statusText}
            </div>
          </div>

          {/* Mobile odds row */}
          <div className="mt-2 grid grid-cols-3 gap-1 md:hidden">
            {LIVE_MARKETS.map((marketId) => {
              const value = summaryMap[marketId];
              const selectionId = `${match.match}-${marketId.toUpperCase()}`;
              return (
                <LiveOddButton
                  key={`mobile-${marketId}`}
                  value={value}
                  selected={selectedOdds?.has(selectionId)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!value) return;
                    onOddsClick?.({
                      id: selectionId,
                      apiFixtureId: match.apiFixtureId,
                      matchName: match.match,
                      ...resolveCompactMarketToken(marketId),
                      value,
                      kickoffAt: match.kickoffAt,
                      matchStatus: match.liveStatus ?? match.status,
                      fromLive: true,
                    });
                  }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-end text-[10px] font-semibold text-[#ef4444] md:hidden">
            <LiveIndicator />
            {statusText}
          </div>
        </div>
      </div>

      {isExpanded &&
        (matchHasExpansionCategories(match) ? (
          <LiveExpansion
            match={match}
            onClose={onToggle}
            onOddsClick={onOddsClick}
            selectedOdds={selectedOdds}
          />
        ) : (
          <LiveExpansionEmpty onClose={onToggle} />
        ))}
    </article>
  );
}

function LiveMatchesList({
  matches,
  loading,
  expandedMatchId,
  onMatchClick,
  onOddsClick,
  selectedOdds,
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-[rgba(255,255,255,0.72)]">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-ping rounded-full bg-red-500/20" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-(--sb-bg-2) ring-2 ring-red-500/30">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#019052] border-t-red-500" />
          </div>
        </div>
        <span className="mt-4 text-sm font-semibold">Loading live games…</span>
      </div>
    );
  }

  if (!matches.length) {
    return (
      <div className="mx-2 mb-3 mt-1 rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/88 via-(--sb-bg-2)/92 to-(--sb-bg-page)/92 px-4 py-14 text-center ">
        <p className="m-0 text-sm font-medium text-[rgba(255,255,255,0.72)]">
          No live games right now.
        </p>
      </div>
    );
  }

  return (
    <section className="sb-card mx-2 mb-3 mt-1 overflow-hidden rounded-[1.25rem] animate-deposit-panel">
      <header className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px_72px] items-center gap-2 border-b border-white/8 bg-(--sb-accent-surface-deep)/40 px-3 py-2.5 text-[11px] font-semibold text-[rgba(255,255,255,0.72)] max-md:grid-cols-1">
        <span>Teams</span>
        <span className="text-center max-md:hidden">1</span>
        <span className="text-center max-md:hidden">X</span>
        <span className="text-center max-md:hidden">2</span>
        <span className="max-md:hidden" />
      </header>
      {matches.map((match) => (
        <LiveRow
          key={match.id}
          match={match}
          isExpanded={expandedMatchId === match.id}
          onToggle={() => onMatchClick?.(match)}
          onOddsClick={onOddsClick}
          selectedOdds={selectedOdds}
        />
      ))}
    </section>
  );
}

function Live() {
  const initialBet = loadBetSlipState();
  const [liveFixtures, setLiveFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeagueId, setSelectedLeagueId] = useState("all-leagues");
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [activeSlip, setActiveSlip] = useState(initialBet.activeSlip);
  const [slips, setSlips] = useState(initialBet.slips);
  const [slipLimitNotice, setSlipLimitNotice] = useState(null);

  const refreshLiveAbortRef = useRef(null);

  const selectedOdds = useMemo(
    () => new Set((slips[activeSlip] || []).map((s) => s.id)),
    [activeSlip, slips],
  );

  const refreshLive = useCallback(async () => {
    refreshLiveAbortRef.current?.abort();
    const ac = new AbortController();
    refreshLiveAbortRef.current = ac;
    const { signal } = ac;

    try {
      const [rows, liveOddsData] = await Promise.all([
        fetchFixturesLive({ signal }),
        fetchLiveOdds({ signal }).catch(() => []),
      ]);

      if (signal.aborted) return;

      const liveOddsMap = new Map(
        (liveOddsData || []).map((o) => [
          normalizeApiFixtureId(o.api_fixture_id),
          o,
        ]),
      );

      setLiveFixtures(
        (Array.isArray(rows) ? rows : []).map((fx) => {
          const liveOdds = liveOddsMap.get(
            normalizeApiFixtureId(fx.api_fixture_id),
          );
          return {
            ...fx,
            _liveElapsed: liveOdds?.elapsed ?? null,
            _liveElapsedSeconds: liveOdds?.elapsed_seconds ?? null,
            _liveStatus: liveOdds?.status ?? null,
            _liveMarkets: liveOdds?.markets ?? null,
            home_score: liveOdds?.home_score ?? fx.home_score ?? null,
            away_score: liveOdds?.away_score ?? fx.away_score ?? null,
          };
        }),
      );
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Live refresh failed:", err);
      setLiveFixtures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLive();
    const id = setInterval(() => {
      void refreshLive().catch(() => {});
    }, LIVE_REFRESH_MS);
    return () => {
      clearInterval(id);
      refreshLiveAbortRef.current?.abort();
    };
  }, [refreshLive]);

  const allMatches = useMemo(
    () =>
      liveFixtures.map((fx) => {
        const base = mapFixtureToMatch(fx);
        const result = {
          ...base,
          elapsed: fx._liveElapsed ?? base.elapsed ?? null,
          elapsedSeconds: fx._liveElapsedSeconds ?? null,
          liveStatus: fx._liveStatus ?? base.status ?? null,
          homeScore: fx.home_score ?? base.homeScore ?? null,
          awayScore: fx.away_score ?? base.awayScore ?? null,
        };

        if (fx._liveMarkets?.length) {
          const liveCategories = fx._liveMarkets
            .map((m) => ({
              category: m.name,
              odds: m.odd_lines.map((ol) => ({
                id: ol.value,
                value: ol.odd,
              })),
            }))
            .filter((c) => c.odds.length > 0);

          result.detailedOdds = {
            main: liveCategories.filter((c) =>
              isLiveMainMarketCategory(c.category),
            ),
            extra: liveCategories.filter(
              (c) => !isLiveMainMarketCategory(c.category),
            ),
          };
          result.sideBets = liveCategories.length;

          const summaryMarkets = [];
          let bestThreeWay = null;
          let bestThreeWayPri = -1;
          for (const m of fx._liveMarkets) {
            const p = liveThreeWayMarketPriority(m.name);
            if (p > bestThreeWayPri) {
              bestThreeWayPri = p;
              bestThreeWay = m;
            }
          }
          if (bestThreeWay) {
            for (const ol of bestThreeWay.odd_lines || []) {
              const v = String(ol.value || "").toLowerCase();
              if (v === "home" || v === "1")
                summaryMarkets.push({ id: "1", value: ol.odd });
              if (v === "draw" || v === "x")
                summaryMarkets.push({ id: "x", value: ol.odd });
              if (v === "away" || v === "2")
                summaryMarkets.push({ id: "2", value: ol.odd });
            }
          }
          const dcMarket = fx._liveMarkets.find((m) =>
            isLiveDoubleChanceMarket(m.name),
          );
          if (dcMarket) {
            for (const ol of dcMarket.odd_lines || []) {
              const v = String(ol.value || "").toLowerCase();
              if (v.includes("home") && v.includes("draw"))
                summaryMarkets.push({ id: "1x", value: ol.odd });
              if (v.includes("home") && v.includes("away"))
                summaryMarkets.push({ id: "12", value: ol.odd });
              if (v.includes("away") && v.includes("draw"))
                summaryMarkets.push({ id: "x2", value: ol.odd });
            }
          }
          if (summaryMarkets.length > 0) {
            result.markets = summaryMarkets;
          }
        }

        return result;
      }),
    [liveFixtures],
  );

  const { catalogItems } = useFootballSidebarCatalog();

  useEffect(() => {
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

  const filteredMatches = useMemo(() => {
    const list =
      selectedLeagueId === "all-leagues"
        ? allMatches
        : allMatches.filter((m) => m.league === selectedLeagueId);
    return sortMatchesForDisplay(list);
  }, [allMatches, selectedLeagueId]);

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

  const { regionGroups, countryGroups } = useMemo(
    () => buildLeagueSidebarGroups(catalogItems, leagueCounts, leagueMetaByKey),
    [catalogItems, leagueCounts, leagueMetaByKey],
  );

  const sidebarSports = useMemo(
    () =>
      sportsList.map((sport) => ({
        ...sport,
        count: sport.id === "football" ? allMatches.length : 0,
      })),
    [allMatches],
  );

  const selections = slips[activeSlip];

  const handleMatchClick = useCallback((match) => {
    setExpandedMatchId((prev) => (prev === match.id ? null : match.id));
  }, []);

  const handleOddsClick = useCallback(
    (oddData) => {
      setSlipLimitNotice(null);
      const { next, blocked, message } = toggleSlipSelection(
        slips[activeSlip] || [],
        oddData,
      );
      if (blocked) {
        if (message) setSlipLimitNotice(message);
        return;
      }
      setSlips((prev) => ({ ...prev, [activeSlip]: next }));
    },
    [activeSlip, slips],
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
    setSlips((prev) => ({ ...prev, [activeSlip]: [] }));
  }, [activeSlip]);

  const handleReplaceSlipSelections = useCallback(
    (nextSelections) => {
      setSlipLimitNotice(null);
      setSlips((prev) => ({
        ...prev,
        [activeSlip]: clampSelectionsToMax(
          Array.isArray(nextSelections) ? nextSelections : [],
        ),
      }));
    },
    [activeSlip],
  );

  const slipCounts = useMemo(() => slipCountsFromSlips(slips), [slips]);

  const totalLeagueCount = Math.max(
    regionGroups.reduce((s, r) => s + r.leagues.length, 0) +
      countryGroups.reduce((s, c) => s + c.leagues.length, 0),
    0,
  );

  const liveLeaguesSidebarProps = useMemo(
    () => ({
      regionGroups,
      countryGroups,
      allLeaguesId: "all-leagues",
      totalLeagueCount,
      selectedLeagueId,
      onSelectLeague: setSelectedLeagueId,
      selectedTimeId: "all",
      onTimeChange: () => {},
      timeOptions: [],
    }),
    [regionGroups, countryGroups, totalLeagueCount, selectedLeagueId],
  );

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative">
        <div
          className="pointer-events-none absolute left-1/2 top-[-1rem] h-80 w-[min(100%,56rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.08),transparent_70%)] blur-2xl"
          aria-hidden
        />

        <MainLayout
          left={
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                <TopLeaguesSidebar {...liveLeaguesSidebarProps} />
              </div>
              <SportsSidebar
                sports={sidebarSports}
                selectedSportId="football"
                onSportChange={() => {}}
              />
            </>
          }
          center={
            <>
              <div className="animate-deposit-panel px-2 pt-1 sm:px-3 sm:pt-2">
                <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
                  In play
                </p>
                <h1 className="m-0 bg-gradient-to-r from-[#ffffff] via-[#fecaca] to-[#ffffff] bg-clip-text text-xl font-black tracking-tight text-transparent sm:text-2xl">
                  Live betting
                </h1>
              </div>
              <LiveMatchesList
                matches={filteredMatches}
                loading={loading}
                expandedMatchId={expandedMatchId}
                onMatchClick={handleMatchClick}
                onOddsClick={handleOddsClick}
                selectedOdds={selectedOdds}
              />
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
              slipCounts={slipCounts}
              slipLimitNotice={slipLimitNotice}
              onDismissSlipLimitNotice={() => setSlipLimitNotice(null)}
            />
          }
        />
      </div>
      <MobileBottomBar
        useParentSlip
        selections={selections}
        onRemoveSelection={handleRemoveSelection}
        onClearSelections={handleClearSelections}
        onReplaceSelections={handleReplaceSlipSelections}
        slipLimitNotice={slipLimitNotice}
        onDismissSlipLimitNotice={() => setSlipLimitNotice(null)}
      />
    </PageContainer>
  );
}

export default Live;
