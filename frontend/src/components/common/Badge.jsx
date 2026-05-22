function Badge({ text, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "bg-(--sb-accent-surface) text-(--sb-accent)"
      : "bg-(--sb-bg-2) text-[#ffffff]";
  return (
    <span
      className={`inline-flex items-center rounded-[10px] px-2 py-0.5 text-xs font-extrabold ${toneClass}`}
    >
      {text}
    </span>
  );
}

export default Badge;
