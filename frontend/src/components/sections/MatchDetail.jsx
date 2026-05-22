import { useState } from "react";
import AppIcon from "../common/AppIcon";
import OddsCell from "../common/OddsCell";
import Badge from "../common/Badge";

function CompactMatchRow({ match, isSelected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full cursor-pointer border border-transparent bg-(--sb-bg-2) text-left transition-colors duration-150 ${
        isSelected ? "ring-1 ring-(--sb-accent)" : "hover:bg-(--sb-bg-card)"
      }`}
    >
      <div className="flex items-center justify-between border-b border-b-white/8 px-2.5 py-1 text-xs text-(--sb-text-muted)">
        <span>{match.league}</span>
        <span>{match.date}</span>
      </div>
      <div className="px-2.5 py-1.5">
        <div className="mb-1 text-sm font-bold text-[#f5f7ff]">
          {match.match}
        </div>
        <div className="flex items-center gap-1">
          {match.markets.slice(0, 6).map((m) => (
            <div
              key={m.id}
              className="flex min-w-0 flex-1 items-center justify-center gap-0.5 rounded-sm border border-white/8 bg-(--sb-bg-page) px-1 py-0.5"
            >
              <span className="text-[10px] font-bold text-[#ffffff]">
                {m.id.toUpperCase()}
              </span>
              <span className="text-[10px] font-bold text-(--sb-accent-soft)">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end px-2 py-1">
        <Badge text={`+${match.sideBets}`} tone="positive" />
      </div>
    </button>
  );
}

function OddsCategory({
  category,
  odds,
  icon,
  defaultOpen = false,
  matchName,
  apiFixtureId,
  kickoffAt,
  matchStatus,
  fromLive = false,
  onOddsClick,
  selectedOdds,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-b-white/8">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3 py-2 text-left text-sm font-bold text-[#ffffff]"
      >
        <span className="flex items-center gap-1.5">
          {category}
          {icon && (
            <AppIcon name="circleDot" size={12} className="text-[rgba(255,255,255,0.72)]" />
          )}
        </span>
        <AppIcon
          name={open ? "chevronUp" : "chevronDown"}
          size={14}
          strokeWidth={2.5}
          className="text-[rgba(255,255,255,0.72)]"
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="grid grid-cols-3 gap-1 px-3 pb-2">
          {odds.map((o) => {
            const selId = `${matchName}-${category}-${o.id}`;
            return (
              <OddsCell
                key={o.id}
                label={o.id.toUpperCase()}
                value={o.value}
                selected={selectedOdds?.has(selId)}
                onClick={() =>
                  onOddsClick?.({
                    id: selId,
                    apiFixtureId,
                    matchName,
                    marketLabel: category,
                    label: o.id.toUpperCase(),
                    value: o.value,
                    kickoffAt,
                    matchStatus,
                    fromLive,
                  })
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FootballPitch() {
  return (
    <div className="relative mx-auto my-3 aspect-[2/1.2] w-[90%] max-w-[320px] overflow-hidden rounded-md border-2 border-white/30 bg-(--sb-accent-border)">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[50%] w-[30%] rounded-full border-2 border-white/25" />
      </div>
      <div className="absolute top-0 left-1/2 h-full w-0 -translate-x-1/2 border-l-2 border-white/25" />
      <div className="absolute top-[15%] left-0 h-[70%] w-[18%] border-2 border-l-0 border-white/25" />
      <div className="absolute top-[15%] right-0 h-[70%] w-[18%] border-2 border-r-0 border-white/25" />
      <div className="absolute top-[30%] left-0 h-[40%] w-[8%] border-2 border-l-0 border-white/25" />
      <div className="absolute top-[30%] right-0 h-[40%] w-[8%] border-2 border-r-0 border-white/25" />
      <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
    </div>
  );
}

function MatchDetail({
  matches,
  selectedMatch,
  onSelectMatch,
  onBack,
  onOddsClick,
  selectedOdds,
}) {
  const leagueMatches = matches.filter(
    (m) => m.league === selectedMatch.league,
  );
  const detail = selectedMatch.detailedOdds;

  return (
    <div className="grid gap-2 lg:grid-cols-[1fr_1.2fr] max-lg:grid-cols-1">
      <div className="hidden flex-col gap-1.5 overflow-hidden rounded-lg border border-white/8 bg-(--sb-bg-card) lg:flex">
        <div className="flex items-center gap-2 border-b border-b-white/8 px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border-0 bg-(--sb-bg-2) text-[#ffffff] transition-colors hover:bg-(--sb-bg-2)"
          >
            <AppIcon name="chevronDown" size={14} className="rotate-90" />
          </button>
          <span className="text-sm font-bold text-[#ffffff]">
            {selectedMatch.league}
          </span>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto p-1.5">
          {leagueMatches.map((m) => (
            <CompactMatchRow
              key={m.id}
              match={m}
              isSelected={m.id === selectedMatch.id}
              onClick={() => onSelectMatch(m)}
            />
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/8 bg-(--sb-bg-card)">
        <div className="border-b border-b-white/8 bg-(--sb-bg-2) px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border-0 bg-(--sb-bg-2) text-[#ffffff] transition-colors hover:bg-(--sb-bg-2) lg:hidden"
            >
              <AppIcon name="chevronDown" size={14} className="rotate-90" />
            </button>
            <div>
              <div className="text-xs text-[rgba(255,255,255,0.72)]">
                {selectedMatch.league}
              </div>
              <div className="text-[15px] font-bold text-[#f5f7ff]">
                {selectedMatch.match}
              </div>
            </div>
          </div>
        </div>

        {/* <FootballPitch /> */}

        {detail && (
          <div>
            <div className="border-b border-b-white/8 bg-(--sb-accent-surface-deep) px-3 py-1.5 text-xs font-extrabold tracking-wider text-(--sb-accent)">
              MAIN
            </div>
            {detail.main.map((cat) => (
              <OddsCategory
                key={cat.category}
                category={cat.category}
                odds={cat.odds}
                icon={cat.icon}
                defaultOpen
                matchName={selectedMatch.match}
                apiFixtureId={selectedMatch.apiFixtureId}
                kickoffAt={selectedMatch.kickoffAt}
                matchStatus={selectedMatch.status}
                fromLive={false}
                onOddsClick={onOddsClick}
                selectedOdds={selectedOdds}
              />
            ))}

            {detail.extra.map((cat) => (
              <OddsCategory
                key={cat.category}
                category={cat.category}
                odds={cat.odds}
                matchName={selectedMatch.match}
                apiFixtureId={selectedMatch.apiFixtureId}
                kickoffAt={selectedMatch.kickoffAt}
                matchStatus={selectedMatch.status}
                fromLive={false}
                onOddsClick={onOddsClick}
                selectedOdds={selectedOdds}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MatchDetail;
