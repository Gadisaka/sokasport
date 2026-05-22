function OddsCell({ label, value, selected, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-all duration-200 ${
        selected
          ? "border-(--sb-accent-fill) bg-(--sb-accent-surface) shadow-[0_0_8px_rgba(1,144,82,0.25)]"
          : "border-transparent bg-(--sb-bg-page) hover:bg-(--sb-bg-card)"
      } ${className}`.trim()}
    >
      {label ? (
        <span className="text-[10px] font-bold uppercase text-(--sb-text-muted)">
          {label}
        </span>
      ) : null}
      <span
        className={`text-[13px] font-bold ${
          selected ? "text-(--sb-accent-fill)" : "text-(--sb-odds-value)"
        }`}
      >
        {value}
      </span>
    </button>
  );
}

export default OddsCell;
