import AppIcon from "./AppIcon";

function IconTextItem({
  icon = "circle",
  text,
  trailing,
  active = false,
  compact = false,
  withChevron = false,
  className = "",
  onClick,
}) {
  const interactive = typeof onClick === "function";
  const Component = interactive ? "button" : "div";
  return (
    <Component
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={`flex items-center justify-between gap-2 border-b border-b-white/8 ${
        compact ? "px-2.5 py-2 text-[12px]" : "px-[11px] py-[9px] text-sm"
      } font-semibold transition-colors ${
        active ? "bg-(--sb-bg-2)" : "hover:bg-(--sb-bg-2)"
      } ${interactive ? "w-full cursor-pointer border-0 bg-transparent text-left" : ""} ${className}`.trim()}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[rgba(255,255,255,0.72)]">
          <AppIcon name={icon} size={compact ? 11 : 12} strokeWidth={2.5} />
        </span>
        <span className="truncate whitespace-nowrap text-[#ffffff]">
          {text}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {typeof trailing !== "undefined" ? (
          <span className={`${compact ? "text-[11px]" : "text-sm"} font-bold text-[rgba(255,255,255,0.72)]`}>
            {trailing}
          </span>
        ) : null}
        {withChevron ? (
          <span className="text-[rgba(255,255,255,0.5)]">
            <AppIcon name="chevronRight" size={12} strokeWidth={2.6} />
          </span>
        ) : null}
      </div>
    </Component>
  );
}

export default IconTextItem;
