import { useEffect, useMemo, useRef, useState } from "react";
import { timeOptionDisplayLabel } from "../../i18n/coreTranslations.js";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { getNextCalendarDayTimeId } from "../../utils/sportsbookTimeOptions.js";

/**
 * @param {{
 *   resolvedTimeId: string;
 *   timeOptions: { id: string; label?: string; labelKey?: string | null }[];
 *   horizonDays: number;
 *   onSelectDay: (timeId: string) => void;
 *   disabled?: boolean;
 *   requireLastMatchPage?: boolean; // last match page only (no scroll sentinel)
 *   isLastMatchPage?: boolean;
 * }} props
 */
function NextCalendarDayFooter({
  resolvedTimeId,
  timeOptions,
  horizonDays,
  onSelectDay,
  disabled = false,
  requireLastMatchPage = false,
  isLastMatchPage = true,
}) {
  const { t } = useTranslation();

  const nextId = useMemo(
    () => getNextCalendarDayTimeId(resolvedTimeId, horizonDays),
    [resolvedTimeId, horizonDays],
  );

  const nextMeta = useMemo(() => {
    if (!nextId) return null;
    return timeOptions.find((o) => o.id === nextId) ?? null;
  }, [nextId, timeOptions]);

  const sentinelRef = useRef(null);
  const [bottomReached, setBottomReached] = useState(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [pageScrollable, setPageScrollable] = useState(false);

  useEffect(() => {
    setBottomReached(false);
  }, [resolvedTimeId, nextId]);

  useEffect(() => {
    const rootEl = document.documentElement;
    const measure = () => {
      setPageScrollable(rootEl.scrollHeight > rootEl.clientHeight + 2);
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [nextId, nextMeta, resolvedTimeId]);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 4) setUserHasScrolled(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!nextId || !nextMeta) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;

    const obs = new IntersectionObserver(
      ([entry]) => {
        setBottomReached(entry.isIntersecting);
      },
      { root: null, threshold: 0, rootMargin: "0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextId, nextMeta]);

  if (!nextId || !nextMeta) return null;

  const label = timeOptionDisplayLabel(nextMeta, t);
  const ariaLabel = `${t("common.goToNextDay")} ${label}`;
  const showByScroll =
    bottomReached && (!pageScrollable || userHasScrolled);
  const showButton = requireLastMatchPage
    ? isLastMatchPage
    : showByScroll;

  return (
    <>
      {!requireLastMatchPage ? (
        <div
          ref={sentinelRef}
          className="pointer-events-none h-1 w-full shrink-0"
          aria-hidden
        />
      ) : null}
      {showButton ? (
        <div className="flex justify-center px-2 pb-3 pt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelectDay(nextId)}
            aria-label={ariaLabel}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-2xl border border-(--sb-accent-border) bg-(--sb-accent-surface-alt) px-5 py-2 text-sm font-bold text-(--sb-accent-text-on-dark) shadow-[0_6px_20px_-8px_rgba(1,144,82,0.35)] transition-colors hover:bg-(--sb-accent-surface) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default NextCalendarDayFooter;
