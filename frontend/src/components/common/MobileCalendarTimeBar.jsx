import { useMemo } from "react";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { timeOptionDisplayLabel } from "../../i18n/coreTranslations.js";
import {
  buildMobileCalendarGroups,
  calendarTimeIdToUtcDayOffset,
} from "../../utils/sportsbookTimeOptions";

const daySelectClassName =
  "h-8 min-h-[32px] w-full min-w-0 cursor-pointer rounded-xl border-0 bg-(--sb-accent-surface-deep) px-2.5 text-[11px] font-bold text-[#ffffff] outline-none";

const chipClass = (active) =>
  `h-8 min-h-[32px] shrink-0 cursor-pointer rounded-xl border px-3 text-[11px] font-bold transition-all duration-200 ${
    active
      ? "border-transparent bg-(--sb-accent-fill) text-white shadow-[0_6px_16px_-6px_rgba(1,144,82,0.3)]"
      : "border-transparent bg-(--sb-bg-page) text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-card-elevated)"
  }`;

function MobileCalendarTimeBar({
  timeOptions = [],
  dateDropdownOptions = [],
  selectedTimeId,
  onTimeChange,
  horizonDays = 14,
  compact = false,
}) {
  const { t } = useTranslation();
  const groups = useMemo(
    () =>
      buildMobileCalendarGroups(timeOptions, {
        dateDropdownOptions,
        horizonDays,
      }),
    [timeOptions, dateDropdownOptions, horizonDays],
  );

  const selectedOffset = calendarTimeIdToUtcDayOffset(selectedTimeId);
  const pickerOffsets = new Set(groups.pickerDays.map((d) => d.offset));
  const pickerSelectValue =
    selectedOffset !== null && pickerOffsets.has(selectedOffset)
      ? selectedTimeId
      : "";

  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "py-0.5"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.hourBuckets.map((time) => (
          <button
            key={time.id}
            type="button"
            onClick={() => onTimeChange?.(time.id)}
            className={chipClass(time.id === selectedTimeId)}
          >
            {timeOptionDisplayLabel(time, t)}
          </button>
        ))}
        {groups.quickTabs.map((day) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onTimeChange?.(day.id)}
            className={chipClass(day.id === selectedTimeId)}
          >
            {timeOptionDisplayLabel(day, t)}
          </button>
        ))}
      </div>

      {groups.pickerDays.length > 0 ? (
        <label className="block min-w-0 text-[10px] font-bold uppercase tracking-wide text-(--sb-text-muted)">
          {t("sidebar.pickDate")}
          <select
            className={`${daySelectClassName} mt-0.5`}
            value={pickerSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onTimeChange?.(v);
            }}
            aria-label={t("sidebar.pickDateAria")}
          >
            <option value="">{t("sidebar.selectDay")}</option>
            {groups.pickerDays.map((day) => (
              <option key={day.id} value={day.id}>
                {timeOptionDisplayLabel(day, t)}
                {day.count > 0 ? ` (${day.count})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export default MobileCalendarTimeBar;
