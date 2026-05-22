export default function PanelCard({ children, className = "" }) {
  return (
    <div
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-sm shadow-[0_4px_12px_rgba(15,23,42,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}
