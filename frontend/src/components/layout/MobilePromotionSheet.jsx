import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import { INFO_PAGE_SLUG_ORDER, CONTACT_PAGE_SLUG } from "../../data/infoPages";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

const PROMOTION_SLUGS = INFO_PAGE_SLUG_ORDER.filter(
  (slug) => slug !== CONTACT_PAGE_SLUG,
);

function MobilePromotionSheet({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return createPortal(
    <div
      className={`fixed inset-0 z-58 transition-opacity duration-300 ease-out lg:hidden ${
        open
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#050914]/50 backdrop-blur-[1px]"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        aria-label={t("common.close")}
      />
      <div
        className={`absolute inset-x-0 bottom-16 flex max-h-[min(50vh,360px)] flex-col overflow-hidden rounded-t-2xl bg-(--sb-bg-page) shadow-[0_-12px_40px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={t("mobileBar.promotion")}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2.5">
          <span className="text-sm font-bold uppercase tracking-wide text-white">
            {t("mobileBar.promotion")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent py-1 pl-2 text-[11px] font-bold uppercase tracking-wide text-[rgba(255,255,255,0.72)]"
            aria-label={t("common.close")}
          >
            <AppIcon name="chevronDown" size={20} strokeWidth={2} />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {PROMOTION_SLUGS.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/info/${slug}`);
                }}
                className="flex w-full cursor-pointer items-center justify-between rounded-xl border-0 bg-(--sb-accent-surface-deep)/40 px-4 py-3.5 text-left text-sm font-bold text-white transition-colors hover:bg-(--sb-bg-card)"
              >
                {t(`infoPage.${slug}`)}
                <AppIcon
                  name="chevronRight"
                  size={16}
                  className="text-(--sb-text-muted)"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

export default MobilePromotionSheet;
