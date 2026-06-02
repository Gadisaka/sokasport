import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { paginateGroupedMatches } from "../../utils/matchPagination";
import AppIcon from "../common/AppIcon";
import LogoImg from "../common/LogoImg";
import ExpansionMarketSection from "../common/ExpansionMarketSection";
import Panel from "../common/Panel";
import {
  MARKET_FILTER_CHIPS,
  MARKET_FILTER_ALL_CHIP_ID,
  filterCategoriesByChipId,
} from "../../data/footballMarketsByCategory";
import { groupMatchesByLeague } from "../../utils/matchDisplaySort";

const TABLE_GRID_COLS =
  "grid-cols-[64px_minmax(220px,1fr)_repeat(6,82px)_58px_22px]";
const MATCH_MARKETS = ["1", "x", "2", "1x", "x2", "12"];

function parseDate(date) {
  const [datePart = "", timePart = ""] = String(date || "").split(" ");
  return { datePart, timePart };
}

function formatLeagueLabel(league) {
  const [zone, name] = String(league || "").split(" - ");
  if (!name) return zone || "";
  return `${zone} · ${name}`;
}

function splitMatchTeams(matchName) {
  const [home = "Home", away = "Away"] = String(matchName || "").split(" V ");
  return { home, away };
}

function TableOddButton({ value, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full min-h-[36px] w-full items-center justify-center rounded-lg border px-1 py-1.5 text-[13px] font-bold transition-all duration-200 ${
        selected
          ? "border-(--sb-accent-fill) bg-(--sb-accent-surface) text-(--sb-accent-fill) shadow-[0_0_8px_rgba(1,144,82,0.25)]"
          : "border-transparent bg-(--sb-bg-page) text-(--sb-odds-value) hover:bg-(--sb-bg-card)"
      }`.trim()}
    >
      {value ?? "-"}
    </button>
  );
}

function MatchRow({
  match,
  isExpanded,
  onToggle,
  onOddsClick,
  selectedOdds,
  children,
  rowRef,
}) {
  const marketMap = useMemo(
    () =>
      (match.markets || []).reduce((acc, market) => {
        acc[String(market.id).toLowerCase()] = market.value;
        return acc;
      }, {}),
    [match.markets],
  );
  const { datePart, timePart } = parseDate(match.date);
  const { home, away } = splitMatchTeams(match.match);

  return (
    <article
      ref={rowRef}
      className={`overflow-hidden rounded-xl border border-white/6 transition-all duration-300 ${
        isExpanded
          ? "bg-(--sb-bg-card-elevated) shadow-[0_8px_28px_-8px_rgba(1,144,82,0.12)]"
          : "bg-(--sb-bg-card) shadow-[0_4px_14px_-6px_rgba(0,0,0,0.35)] hover:bg-(--sb-bg-card-elevated)"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer px-2.5 py-2.5 md:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5 text-[11px]">
            <span className="font-medium text-(--sb-text-muted)">{datePart}</span>
            <span className="font-bold text-(--sb-text)">{timePart}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-(--sb-accent-fill) px-2 py-0.5 text-[10px] font-bold text-white">
              +{match.sideBets}
            </span>
            <AppIcon name="chevronDown" size={12} className="text-(--sb-text-muted)" />
          </div>
        </div>

        <div className="mt-2 truncate text-[13px] font-extrabold uppercase tracking-wide text-white">
          {home} V {away}
        </div>

        <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px] font-bold text-(--sb-text-muted)">
          {MATCH_MARKETS.map((marketId) => (
            <span key={`mobile-label-${match.id}-${marketId}`}>
              {marketId.toUpperCase()}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-6 gap-1">
          {MATCH_MARKETS.map((marketId) => {
            const value = marketMap[marketId];
            const selectionId = `${match.match}-${marketId.toUpperCase()}`;
            return (
              <TableOddButton
                key={`mobile-odd-${match.id}-${marketId}`}
                value={value ?? "-"}
                selected={selectedOdds?.has(selectionId)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!value) return;
                  onOddsClick?.({
                    id: selectionId,
                    apiFixtureId: match.apiFixtureId,
                    matchName: match.match,
                    marketLabel: "Match Winner",
                    label: marketId.toUpperCase(),
                    value,
                    kickoffAt: match.kickoffAt,
                    matchStatus: match.status,
                    fromLive: false,
                  });
                }}
              />
            );
          })}
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`hidden md:grid ${TABLE_GRID_COLS} min-h-[46px] min-w-[860px] cursor-pointer items-stretch border-b border-white/8 px-2 py-1 hover:bg-(--sb-accent-surface-deep)/35`}
      >
        <div className="flex flex-col justify-center border-r border-white/8 pr-2 text-center text-[10px]">
          <span className="font-medium text-[#5a8a7a]">{datePart}</span>
          <span className="font-bold text-(--sb-positive)">{timePart}</span>
        </div>
        <div className="flex flex-col justify-center gap-0.5 border-r border-white/8 px-2 py-0.5 text-[14px] font-semibold text-[#f3f4ff]">
          <div className="flex min-h-[22px] items-center gap-2">
            {match.homeTeamLogo ? (
              <LogoImg
                src={match.homeTeamLogo}
                alt=""
                size={18}
                className="border border-transparent bg-(--sb-bg-page)"
              />
            ) : null}
            <span className="truncate">{home}</span>
          </div>
          <div className="flex min-h-[22px] items-center gap-2 text-[#8ab5a8]">
            {match.awayTeamLogo ? (
              <LogoImg
                src={match.awayTeamLogo}
                alt=""
                size={18}
                className="border border-transparent bg-(--sb-bg-page)"
              />
            ) : null}
            <span className="truncate">{away}</span>
          </div>
        </div>
        {MATCH_MARKETS.map((marketId) => {
          const value = marketMap[marketId];
          const selectionId = `${match.match}-${marketId.toUpperCase()}`;
          return (
            <div key={marketId} className="px-1">
              <TableOddButton
                value={value ?? "-"}
                selected={selectedOdds?.has(selectionId)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!value) return;
                  onOddsClick?.({
                    id: selectionId,
                    apiFixtureId: match.apiFixtureId,
                    matchName: match.match,
                    marketLabel: "Match Winner",
                    label: marketId.toUpperCase(),
                    value,
                    kickoffAt: match.kickoffAt,
                    matchStatus: match.status,
                    fromLive: false,
                  });
                }}
              />
            </div>
          );
        })}
        <div className="flex items-center justify-end px-1 text-[11px] font-bold text-(--sb-positive)">
          +{match.sideBets}
        </div>
        <div className="flex items-center justify-center text-(--sb-text-muted)">
          <AppIcon name="chevronDown" size={12} />
        </div>
      </div>
      {children}
    </article>
  );
}

function matchHasExpansionCategories(match) {
  const d = match?.detailedOdds;
  return (
    (Array.isArray(d?.main) && d.main.length > 0) ||
    (Array.isArray(d?.extra) && d.extra.length > 0)
  );
}

function MatchExpansionSkeleton({ onClose }) {
  return (
    <div
      className="border-t border-white/6 bg-gradient-to-b from-(--sb-bg-page)/98 to-(--sb-accent-surface-deep)/98"
      aria-busy="true"
      aria-label="Loading odds"
    >
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-5 w-24 shrink-0 animate-pulse rounded bg-(--sb-bg-card)" />
          <div className="h-4 w-40 max-w-[50%] animate-pulse rounded bg-(--sb-bg-card)" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-(--sb-bg-2)"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 bg-(--sb-bg-page)/92 px-3 py-3">
        <div className="mx-auto mb-2 h-3 w-24 animate-pulse rounded bg-(--sb-bg-card)" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="h-9 w-9 animate-pulse rounded-full bg-(--sb-bg-card)" />
            <div className="h-3 w-20 animate-pulse rounded bg-(--sb-bg-card)" />
          </div>
          <div className="h-3 w-6 animate-pulse rounded bg-(--sb-bg-card)" />
          <div className="flex flex-col items-center gap-2">
            <div className="h-9 w-9 animate-pulse rounded-full bg-(--sb-bg-card)" />
            <div className="h-3 w-20 animate-pulse rounded bg-(--sb-bg-card)" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/8 px-3 py-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-7 w-16 animate-pulse rounded-full bg-(--sb-bg-card)"
          />
        ))}
      </div>

      <div className="space-y-2 p-2.5">
        {[1, 2, 3].map((block) => (
          <div
            key={block}
            className="overflow-hidden rounded-xl bg-(--sb-accent-surface-deep)/35"
          >
            <div className="border-b border-white/8 px-3 py-2">
              <div className="h-3 w-28 animate-pulse rounded bg-(--sb-bg-card)" />
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, j) => (
                <div
                  key={j}
                  className="h-9 animate-pulse rounded bg-(--sb-bg-card)"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchExpansionEmpty({ match, onClose }) {
  const { datePart, timePart } = parseDate(match.date);
  return (
    <div className="border-t border-white/6 bg-gradient-to-b from-(--sb-bg-page)/98 to-(--sb-accent-surface-deep)/98">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <span className="text-[11px] font-semibold text-[#7f89a4]">
          {datePart} {timePart}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-(--sb-bg-2)"
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

function MatchExpansion({ match, onClose, onOddsClick, selectedOdds }) {
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
  const filteredCategories = filterCategoriesByChipId(
    categories,
    activeChipId,
  );
  const showFilteredEmpty =
    activeChipId !== MARKET_FILTER_ALL_CHIP_ID &&
    filteredCategories.length === 0;
  const visibleCategories = filteredCategories;
  const { home, away } = splitMatchTeams(match.match);
  const { datePart, timePart } = parseDate(match.date);

  if (!categories.length) {
    return <MatchExpansionEmpty match={match} onClose={onClose} />;
  }

  return (
    <div className="border-t border-white/6 bg-gradient-to-b from-(--sb-bg-page)/98 to-(--sb-accent-surface-deep)/98">
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
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-(--sb-bg-2)"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 bg-(--sb-bg-page)/92 px-3 py-3">
        <div className="mb-1 text-center text-[11px] font-semibold text-[#7f89a4]">
          {datePart} {timePart}
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
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/8 px-3 py-2">
        {MARKET_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setActiveChipId(chip.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
              chip.id === activeChipId
                ? "border-(--sb-accent) bg-(--sb-accent-surface) text-(--sb-accent-text-soft) shadow-[0_4px_12px_-4px_rgba(1,144,82,0.25)]"
                : "border-transparent bg-(--sb-accent-surface-deep)/55 text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-2)"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 p-2.5">
        {showFilteredEmpty ? (
          <p className="rounded-xl bg-(--sb-accent-surface-deep)/45 px-3 py-8 text-center text-xs text-[#7f89a4]">
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
                matchStatus={match.status}
                fromLive={false}
                onOddsClick={handleOddsInExpansion}
                selectedOdds={selectedOdds}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function MatchesTable({
  matches,
  onMatchClick,
  onOddsClick,
  selectedOdds,
  expandedMatchId,
  oddsDetailByFixtureId,
  onPageMetaChange,
}) {
  const { t } = useTranslation();
  const [pageIndex, setPageIndex] = useState(0);

  const allGrouped = useMemo(() => groupMatchesByLeague(matches), [matches]);

  const pagination = useMemo(
    () => paginateGroupedMatches(allGrouped, pageIndex),
    [allGrouped, pageIndex],
  );

  const groupedMatches = pagination.grouped;

  useEffect(() => {
    setPageIndex(0);
  }, [matches]);

  useEffect(() => {
    onPageMetaChange?.({
      page: pagination.page,
      totalPages: pagination.totalPages,
      isLastPage: pagination.isLastPage,
      totalMatches: pagination.totalMatches,
      showPagination: pagination.showPagination,
    });
  }, [
    onPageMetaChange,
    pagination.page,
    pagination.totalPages,
    pagination.isLastPage,
    pagination.totalMatches,
    pagination.showPagination,
  ]);

  const goToPage = useCallback((nextPage) => {
    setPageIndex((p) => {
      const max = Math.max(0, pagination.totalPages - 1);
      const clamped = Math.min(Math.max(0, nextPage), max);
      if (clamped !== p) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return clamped;
    });
  }, [pagination.totalPages]);

  const matchRowRefs = useRef(new Map());
  const prevExpandedMatchIdRef = useRef(expandedMatchId);

  useEffect(() => {
    const prev = prevExpandedMatchIdRef.current;
    prevExpandedMatchIdRef.current = expandedMatchId;

    if (expandedMatchId != null || prev == null) return;

    const el = matchRowRefs.current.get(prev);
    if (!el) return;

    const id = requestAnimationFrame(() => {
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    });

    return () => cancelAnimationFrame(id);
  }, [expandedMatchId]);

  return (
    <Panel className="animate-deposit-panel overflow-hidden">
      <div className="space-y-2 p-2">
        {groupedMatches.map(([league, leagueMatches]) => {
          const head = leagueMatches[0];
          return (
            <section
              key={league}
              className="overflow-hidden rounded-xl"
            >
              <header className="border-b border-white/8 bg-(--sb-bg-page)">
                <div className="flex items-center gap-2 px-2.5 py-2 text-sm font-semibold text-(--sb-text-muted)">
                  {head?.countryFlag ? (
                    <LogoImg
                      src={head.countryFlag}
                      alt=""
                      size={18}
                      rounded="rounded-[2px]"
                      className="border border-transparent"
                    />
                  ) : null}
                  {head?.leagueLogo ? (
                    <LogoImg
                      src={head.leagueLogo}
                      alt=""
                      size={20}
                      className="border border-transparent bg-(--sb-bg-page)"
                    />
                  ) : (
                    <AppIcon
                      name="circleDot"
                      size={12}
                      className="text-(--sb-accent)"
                    />
                  )}
                  <span className="min-w-0 truncate">
                    {formatLeagueLabel(league)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div
                    className={`hidden md:grid ${TABLE_GRID_COLS} min-w-[860px] px-2 py-1 text-[11px] font-bold text-(--sb-text-muted)`}
                  >
                    <span />
                    <span />
                    {MATCH_MARKETS.map((marketId) => (
                      <span
                        key={`header-${league}-${marketId}`}
                        className="px-1 text-center"
                      >
                        {marketId.toUpperCase()}
                      </span>
                    ))}
                    <span className="text-center text-[#8b95b2]">+</span>
                    <span />
                  </div>
                </div>
              </header>

              <div className="space-y-1 overflow-x-auto bg-(--sb-bg-page) py-1">
                {leagueMatches.map((match) => {
                  const isExpanded = expandedMatchId === match.id;
                  return (
                    <MatchRow
                      key={match.id}
                      match={match}
                      isExpanded={isExpanded}
                      onToggle={() => onMatchClick?.(match)}
                      onOddsClick={onOddsClick}
                      selectedOdds={selectedOdds}
                      rowRef={(el) => {
                        if (el) matchRowRefs.current.set(match.id, el);
                        else matchRowRefs.current.delete(match.id);
                      }}
                    >
                      {isExpanded ? (
                        !oddsDetailByFixtureId?.has?.(match.apiFixtureId) ? (
                          <MatchExpansionSkeleton
                            onClose={() => onMatchClick?.(match)}
                          />
                        ) : matchHasExpansionCategories(match) ? (
                          <MatchExpansion
                            match={match}
                            onClose={() => onMatchClick?.(match)}
                            onOddsClick={onOddsClick}
                            selectedOdds={selectedOdds}
                          />
                        ) : (
                          <MatchExpansionEmpty
                            match={match}
                            onClose={() => onMatchClick?.(match)}
                          />
                        )
                      ) : null}
                    </MatchRow>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {pagination.showPagination ? (
        <div className="flex flex-col items-center gap-2 border-t border-white/8 px-3 py-3">
          <p className="m-0 text-[11px] font-semibold text-(--sb-text-muted)">
            {t("matches.pageOf")
              .replace("{page}", String(pagination.page + 1))
              .replace("{total}", String(pagination.totalPages))}
          </p>
          <div className="flex w-full max-w-xs items-center justify-center gap-2">
            <button
              type="button"
              disabled={pagination.isFirstPage}
              onClick={() => goToPage(pageIndex - 1)}
              className="min-h-9 flex-1 cursor-pointer rounded-xl border border-transparent bg-(--sb-accent-surface-deep) px-3 text-[12px] font-bold text-[#ffffff] transition-all hover:bg-(--sb-bg-2) disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("matches.prev")}
            </button>
            <button
              type="button"
              disabled={pagination.isLastPage}
              onClick={() => goToPage(pageIndex + 1)}
              className="min-h-9 flex-1 cursor-pointer rounded-xl border border-transparent bg-(--sb-accent-fill) px-3 text-[12px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(1,144,82,0.3)] transition-all hover:bg-(--sb-accent-fill-hover) disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("matches.next")}
            </button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

export default MatchesTable;
