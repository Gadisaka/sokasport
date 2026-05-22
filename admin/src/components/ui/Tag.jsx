export default function Tag({ children }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-2 py-1 text-[0.72rem] font-semibold text-[var(--muted)]">
      {children}
    </span>
  );
}
