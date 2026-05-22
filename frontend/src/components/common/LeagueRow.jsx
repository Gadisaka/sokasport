import Badge from './Badge'
import OddsCell from './OddsCell'
import AppIcon from './AppIcon'

function LeagueRow({ league, match, date, markets, sideBets, onClick, onOddsClick, selectedOdds }) {
  return (
    <article
      className="cursor-pointer border border-transparent bg-(--sb-bg-2) transition-colors duration-150 hover:bg-(--sb-bg-card)"
      onClick={onClick}
    >
      <header className="flex items-center justify-between border-b border-b-[#2f3047] px-2.5 py-1.5 text-sm font-semibold text-[#cfd2e4]">
        <span>{league}</span>
        <span>{date}</span>
      </header>
      <div className="p-1.5">
        <div className="mb-1.5 flex items-center gap-2 text-[15px] font-bold text-[#f5f7ff]">
          <span className="inline-flex h-3 w-3 items-center justify-center text-[#f1f2fa]">
            <AppIcon name="circleDot" size={12} strokeWidth={2.2} />
          </span>
          <span>{match}</span>
        </div>
        <div className="grid grid-cols-3 gap-1 lg:grid-cols-4 xl:grid-cols-8">
          {markets.map((market, i) => {
            const selId = `${match}-${market.id}`;
            return (
              <OddsCell
                key={market.id}
                label={market.id.toUpperCase()}
                value={market.value}
                selected={selectedOdds?.has(selId)}
                className={i >= 3 ? "max-lg:hidden" : ""}
                onClick={(e) => {
                  e.stopPropagation();
                  onOddsClick?.({
                    id: selId,
                    matchName: match,
                    marketLabel: "Match Result",
                    label: market.id.toUpperCase(),
                    value: market.value,
                  });
                }}
              />
            );
          })}
        </div>
      </div>
      <footer className="flex justify-end px-2 py-1.5 pt-1">
        <Badge text={`+${sideBets} Side Bets`} tone="positive" />
      </footer>
    </article>
  )
}

export default LeagueRow
