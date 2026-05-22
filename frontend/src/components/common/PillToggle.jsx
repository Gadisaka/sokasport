function PillToggle({
  options,
  className = '',
  optionClassName = '',
  activeOptionClassName = '',
  inactiveOptionClassName = '',
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`.trim()}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`cursor-pointer whitespace-nowrap rounded-[999px] border-0 px-3.5 py-2 text-[13px] font-bold ${
            option.active ? activeOptionClassName : inactiveOptionClassName
          } ${optionClassName}`.trim()}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default PillToggle
