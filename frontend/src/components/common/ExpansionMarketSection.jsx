import { useState } from "react";
import AppIcon from "./AppIcon";
import OddsCell from "./OddsCell";

/** Markets with more than this many selections render as collapsible (initially closed). */
const ODDS_EXPAND_THRESHOLD = 3;

function OddsGrid({
  marketLabel,
  odds,
  matchName,
  apiFixtureId,
  kickoffAt,
  matchStatus,
  fromLive,
  onOddsClick,
  selectedOdds,
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-4">
      {odds.map((odd) => {
        const selectionId = `${matchName}-${marketLabel}-${odd.id}`;
        return (
          <OddsCell
            key={`${marketLabel}-${odd.id}`}
            label={odd.id.toUpperCase()}
            value={odd.value}
            selected={selectedOdds?.has(selectionId)}
            onClick={() =>
              onOddsClick?.({
                id: selectionId,
                apiFixtureId,
                matchName,
                marketLabel,
                label: odd.id.toUpperCase(),
                value: odd.value,
                kickoffAt,
                matchStatus,
                fromLive,
              })
            }
            className="min-h-[36px]"
          />
        );
      })}
    </div>
  );
}

/**
 * @param {{
 *   marketLabel: string,
 *   odds: Array<{ id: string, value: string }>,
 *   matchName: string,
 *   apiFixtureId: unknown,
 *   kickoffAt: string | null,
 *   matchStatus: unknown,
 *   fromLive: boolean,
 *   onOddsClick?: (payload: Record<string, unknown>) => void,
 *   selectedOdds?: Set<string>,
 * }} props
 */
function ExpansionMarketSection({
  marketLabel,
  odds,
  matchName,
  apiFixtureId,
  kickoffAt,
  matchStatus,
  fromLive,
  onOddsClick,
  selectedOdds,
}) {
  const collapsible = odds.length > ODDS_EXPAND_THRESHOLD;
  const [open, setOpen] = useState(false);

  if (!collapsible) {
    return (
      <section className="overflow-hidden rounded-xl bg-(--sb-accent-surface-deep)/45 ">
        <header className="border-b border-white/8 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#d6daea]">
          {marketLabel}
        </header>
        <OddsGrid
          marketLabel={marketLabel}
          odds={odds}
          matchName={matchName}
          apiFixtureId={apiFixtureId}
          kickoffAt={kickoffAt}
          matchStatus={matchStatus}
          fromLive={fromLive}
          onOddsClick={onOddsClick}
          selectedOdds={selectedOdds}
        />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl bg-(--sb-accent-surface-deep)/45 ">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-(--sb-accent-surface-deep)/55"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-[#d6daea]">
          {marketLabel}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] font-semibold tabular-nums text-[#7f89a4]">
            {odds.length}
          </span>
          <AppIcon
            name={open ? "chevronUp" : "chevronDown"}
            size={14}
            strokeWidth={2.5}
            className="text-[rgba(255,255,255,0.72)]"
          />
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-[4000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <OddsGrid
          marketLabel={marketLabel}
          odds={odds}
          matchName={matchName}
          apiFixtureId={apiFixtureId}
          kickoffAt={kickoffAt}
          matchStatus={matchStatus}
          fromLive={fromLive}
          onOddsClick={onOddsClick}
          selectedOdds={selectedOdds}
        />
      </div>
    </section>
  );
}

export default ExpansionMarketSection;
