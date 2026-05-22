import { useEffect } from "react";
import { createPortal } from "react-dom";
import AppIcon from "../common/AppIcon";
import TopLeaguesSidebar from "./TopLeaguesSidebar";

function MobileLeaguesSheet({ open, onClose, sidebarProps }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!sidebarProps) return null;

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
        aria-label="Close leagues"
      />
      <div
        className={`absolute inset-x-0 bottom-16 flex h-[min(68vh,520px)] max-h-[85vh] flex-col overflow-hidden rounded-t-2xl bg-(--sb-bg-page) shadow-[0_-12px_40px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Leagues"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2.5">
          <span className="text-sm font-bold uppercase tracking-wide text-[#ffffff]">
            Leagues
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent py-1 pl-2 text-[11px] font-bold uppercase tracking-wide text-[rgba(255,255,255,0.72)]"
            aria-label="Close"
          >
            <AppIcon name="chevronDown" size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 px-1 pb-2 pt-1">
          <TopLeaguesSidebar
            {...sidebarProps}
            leaguesListOnly
            panelClassName="h-full min-h-0 !max-h-none rounded-none border-0 !bg-transparent p-2 shadow-none"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MobileLeaguesSheet;
