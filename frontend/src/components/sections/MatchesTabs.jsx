import AppIcon from "../common/AppIcon";
import LogoImg from "../common/LogoImg";
import MobileCalendarTimeBar from "../common/MobileCalendarTimeBar";

import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { timeOptionDisplayLabel } from "../../i18n/coreTranslations.js";

function MatchesTabs({
  sports = [],
  times = [],
  leagues = [],
  dateDropdownOptions = [],
  horizonDays = 14,
  selectedSportId,
  selectedTimeId,
  selectedLeagueId,
  onSportChange,
  onTimeChange,
  onLeagueChange,
  searchQuery = "",
  onSearchChange,
}) {
  const { t } = useTranslation();
  return (
    <section className="sb-card animate-deposit-panel overflow-hidden rounded-[1.15rem] backdrop-blur-sm">
      <div className="border-b border-white/8 px-2 py-1.5">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] font-semibold text-(--sb-text-muted)">
          {sports.map((sport) => (
            <button
              key={sport.id}
              type="button"
              onClick={() => onSportChange?.(sport.id)}
              className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 transition-all duration-200 ${
                sport.id === selectedSportId
                  ? "border-transparent bg-(--sb-accent-fill) text-white shadow-[0_6px_16px_-6px_rgba(1,144,82,0.35)]"
                  : "border-transparent bg-(--sb-bg-page) text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-card-elevated)"
              }`}
            >
              <AppIcon name={sport.icon} size={11} />
              <span>{sport.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-white/8 px-2 py-1.5 md:hidden">
        <MobileCalendarTimeBar
          timeOptions={times}
          dateDropdownOptions={dateDropdownOptions}
          selectedTimeId={selectedTimeId}
          onTimeChange={onTimeChange}
          horizonDays={horizonDays}
        />
      </div>

      <div className="hidden border-b border-white/8 px-2 py-1.5 md:block">
        <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[10px] font-bold">
          {times.map((time) => (
            <button
              key={time.id}
              type="button"
              onClick={() => onTimeChange?.(time.id)}
              className={`h-6 min-h-0 cursor-pointer rounded-xl border px-2.5 transition-all duration-200 ${
                time.id === selectedTimeId
                  ? "border-transparent bg-(--sb-accent-fill) text-white shadow-[0_6px_16px_-6px_rgba(1,144,82,0.3)]"
                  : "border-transparent bg-(--sb-bg-page) text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-card-elevated)"
              }`}
            >
              {timeOptionDisplayLabel(time, t)}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-white/8 px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[10px] font-semibold">
          {leagues.map((league) => (
            <button
              key={league.id}
              type="button"
              onClick={() => onLeagueChange?.(league.id)}
              className={`flex h-6 cursor-pointer items-center gap-1 rounded-xl border px-2.5 transition-all duration-200 ${
                league.id === selectedLeagueId
                  ? "border-transparent bg-(--sb-accent-fill) text-white shadow-[0_4px_12px_-4px_rgba(1,144,82,0.28)]"
                  : "border-transparent bg-(--sb-bg-page) text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-card-elevated)"
              }`}
            >
              {league.countryFlag ? (
                <LogoImg src={league.countryFlag} alt="" size={14} rounded="rounded-[2px]" />
              ) : null}
              {league.logo ? (
                <LogoImg src={league.logo} alt="" size={14} className="max-h-[14px]" />
              ) : null}
              <span className="truncate">{league.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-2">
        <div className="flex h-9 items-center rounded-2xl bg-(--sb-bg-page) px-3 text-[rgba(255,255,255,0.72)] shadow-inner shadow-black/20">
          <AppIcon name="search" size={13} className="mr-2 shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={t("sidebar.searchClubsPlaceholder")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[12px] font-semibold text-[#ffffff] placeholder:text-[rgba(255,255,255,0.45)] outline-none"
            aria-label={t("sidebar.searchClubsAria")}
          />
          {searchQuery ? (
            <button
              type="button"
              className="ml-1 shrink-0 text-[10px] font-bold uppercase text-(--sb-accent)"
              onClick={() => onSearchChange?.("")}
            >
              {t("common.clear")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default MatchesTabs;
