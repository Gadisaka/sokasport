export default function PrimaryButton({
  children,
  type = "button",
  className = "",
  disabled = false,
  onClick,
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`w-full px-4 py-2.5 text-sm font-semibold rounded-sm border border-transparent bg-[var(--accent)] text-white disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
