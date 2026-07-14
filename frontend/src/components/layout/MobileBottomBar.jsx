import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import MobileBetSlip from "../sections/MobileBetSlip";
import MobilePromotionSheet from "./MobilePromotionSheet";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";
import {
  BET_SLIP_STATE_EVENT,
  loadBetSlipState,
  notifyBetSlipStateUpdated,
  persistBetSlipState,
} from "../../utils/betSlipPersistence";
import {
  coerceStakeDisplayToLimits,
} from "../../utils/stakeLimits";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

const navItems = [
  { id: "home", icon: "home", path: "/" },
  { id: "games", icon: "gamepad", path: "/casino" },
  { id: "slip", icon: "ticket", action: "slip" },
  { id: "promotion", icon: "gift", action: "promotion" },
  { id: "contact", icon: "send", path: "/info/contact-us" },
];

const PROMOTION_PATH_PREFIX = "/info/";
const PROMOTION_SLUGS = new Set([
  "faq",
  "how-to-play",
  "privacy-policy",
  "terms-and-conditions",
]);

function MobileBottomBar({
  selections = [],
  onRemoveSelection = () => {},
  onClearSelections = () => {},
  onReplaceSelections = () => {},
  useParentSlip = false,
  slipLimitNotice = null,
  onDismissSlipLimitNotice = () => {},
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [slipOpen, setSlipOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [stakeInput, setStakeInput] = useState("20");
  const [storedSlip, setStoredSlip] = useState(loadBetSlipState);
  const { limits, winningsTax } = usePlatformSettings();

  useEffect(() => {
    if (!limits) return;
    setStakeInput((prev) => coerceStakeDisplayToLimits(prev, limits));
  }, [limits?.MIN_BET_AMOUNT, limits?.MAX_BET_AMOUNT]);

  const reloadStoredSlip = useCallback(() => {
    setStoredSlip(loadBetSlipState());
  }, []);

  useEffect(() => {
    const onUpdate = () => reloadStoredSlip();
    window.addEventListener(BET_SLIP_STATE_EVENT, onUpdate);
    return () => window.removeEventListener(BET_SLIP_STATE_EVENT, onUpdate);
  }, [reloadStoredSlip]);

  const safeParentSelections = Array.isArray(selections) ? selections : [];
  const effectiveSelections = useParentSlip
    ? safeParentSelections
    : storedSlip.slips[storedSlip.activeSlip] || [];

  const selectionCount = effectiveSelections.length;

  const persistAndNotify = useCallback((slips, activeSlip) => {
    persistBetSlipState(slips, activeSlip);
    notifyBetSlipStateUpdated();
  }, []);

  const handleRemoveSelection = useCallback(
    (id) => {
      if (useParentSlip) {
        onRemoveSelection(id);
        return;
      }
      setStoredSlip((prev) => {
        const active = prev.activeSlip;
        const nextSlips = {
          ...prev.slips,
          [active]: prev.slips[active].filter((s) => s.id !== id),
        };
        persistAndNotify(nextSlips, active);
        return { slips: nextSlips, activeSlip: active };
      });
    },
    [useParentSlip, onRemoveSelection, persistAndNotify],
  );

  const handleClearSelections = useCallback(() => {
    if (useParentSlip) {
      onClearSelections();
      return;
    }
    setStoredSlip((prev) => {
      const active = prev.activeSlip;
      const nextSlips = { ...prev.slips, [active]: [] };
      persistAndNotify(nextSlips, active);
      return { slips: nextSlips, activeSlip: active };
    });
  }, [useParentSlip, onClearSelections, persistAndNotify]);

  const handleReplaceSelections = useCallback(
    (nextSelections) => {
      if (useParentSlip) {
        onReplaceSelections(nextSelections);
        return;
      }
      setStoredSlip((prev) => {
        const active = prev.activeSlip;
        const nextSlips = {
          ...prev.slips,
          [active]: Array.isArray(nextSelections) ? nextSelections : [],
        };
        persistAndNotify(nextSlips, active);
        return { slips: nextSlips, activeSlip: active };
      });
    },
    [useParentSlip, onReplaceSelections, persistAndNotify],
  );

  const openSlip = useCallback(() => {
    if (!useParentSlip) reloadStoredSlip();
    setPromotionOpen(false);
    setSlipOpen(true);
  }, [useParentSlip, reloadStoredSlip]);

  const isNavActive = useCallback(
    (item) => {
      if (item.id === "home") {
        return location.pathname === "/";
      }
      if (item.id === "games") {
        return location.pathname === "/casino";
      }
      if (item.id === "contact") {
        return location.pathname === "/info/contact-us";
      }
      if (item.id === "slip") {
        return slipOpen;
      }
      if (item.id === "promotion") {
        if (promotionOpen) return true;
        if (location.pathname.startsWith(PROMOTION_PATH_PREFIX)) {
          const slug = location.pathname.slice(PROMOTION_PATH_PREFIX.length);
          return PROMOTION_SLUGS.has(slug);
        }
      }
      return false;
    },
    [location.pathname, slipOpen, promotionOpen],
  );

  const handleNavClick = useCallback(
    (item) => {
      if (item.disabled) return;
      if (item.action === "slip") {
        openSlip();
        return;
      }
      if (item.action === "promotion") {
        setSlipOpen(false);
        setPromotionOpen(true);
        return;
      }
      if (item.path) {
        setPromotionOpen(false);
        navigate(item.path);
      }
    },
    [navigate, openSlip],
  );

  const bottomNav = (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-white/8 bg-(--sb-bg-page) pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
      {navItems.map((item) => {
        const active = isNavActive(item);
        const colorClass = active
          ? "text-(--sb-accent-fill)"
          : item.disabled
            ? "text-(--sb-text-muted) opacity-40"
            : "text-[#8ab5a8]";

        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            onClick={() => handleNavClick(item)}
            className={`relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent py-2 text-[9px] font-bold leading-tight disabled:cursor-not-allowed ${colorClass}`}
          >
            <span className="relative inline-flex">
              <AppIcon
                name={item.icon}
                size={20}
                strokeWidth={1.8}
                className={colorClass}
              />
              {item.id === "slip" && selectionCount > 0 ? (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--sb-accent-fill) px-1 text-[9px] font-extrabold text-white">
                  {selectionCount > 99 ? "99+" : selectionCount}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate px-0.5">
              {t(`mobileBar.${item.id}`)}
            </span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      <MobileBetSlip
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        selections={effectiveSelections}
        onRemoveSelection={handleRemoveSelection}
        onClearSelections={handleClearSelections}
        onReplaceSelections={handleReplaceSelections}
        stakeInput={stakeInput}
        onStakeInputChange={setStakeInput}
        limits={limits}
        winningsTax={winningsTax}
        slipLimitNotice={slipLimitNotice}
        onDismissSlipLimitNotice={onDismissSlipLimitNotice}
      />
      <MobilePromotionSheet
        open={promotionOpen}
        onClose={() => setPromotionOpen(false)}
      />
      {bottomNav}
      <div className="h-16 lg:hidden" />
    </>
  );
}

export default MobileBottomBar;
