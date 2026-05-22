import { useEffect, useRef } from "react";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title
 * @param {React.ReactNode} props.children
 * @param {string} [props.maxWidthClassName]
 * @param {boolean} [props.centered] — vertically center in the viewport (scroll inside panel if tall)
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClassName = "max-w-lg",
  centered = false,
}) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const overlayClass = centered
    ? "items-center p-4"
    : "items-start px-4 pt-[10vh] pb-12";

  const panelClass = centered
    ? `max-h-[min(90vh,56rem)] flex w-full flex-col ${maxWidthClassName}`
    : `w-full ${maxWidthClassName}`;

  const bodyClass = centered ? "min-h-0 flex-1 overflow-y-auto px-6 py-5" : "px-6 py-5";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 ${overlayClass}`}
    >
      <div
        className={`rounded-sm border border-[var(--border)] bg-[var(--surface)] shadow-xl ${panelClass}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-[var(--muted)] hover:text-[var(--text)]"
          >
            &times;
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
