import { useEffect } from "react";
import { createPortal } from "react-dom";
import AppIcon from "../common/AppIcon";

/**
 * Full-screen overlay hosting an InOut game iframe.
 *
 * Rendered via a portal so it escapes any transformed/overflow-hidden ancestors
 * and always covers the viewport. Locks body scroll while open and closes on
 * Escape.
 *
 * @param {{ url: string, title?: string, onClose: () => void }} props
 */
function GameFrame({ url, title, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[300] flex flex-col bg-black">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#000000] px-3 py-2">
        <span className="truncate text-sm font-semibold text-[#ffffff]">
          {title || "Game"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close game"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border-0 bg-[#0a0a0a]/80 text-[rgba(255,255,255,0.72)] transition-all hover:bg-[#111111] hover:ring-1 hover:ring-(--sb-accent-fill)/25"
        >
          <AppIcon name="x" size={16} />
        </button>
      </div>
      <iframe
        src={url}
        title={title || "Game"}
        scrolling="yes"
        allow="autoplay; fullscreen; payment"
        allowFullScreen
        className="h-full w-full flex-1 border-0"
      />
    </div>,
    document.body,
  );
}

export default GameFrame;
