import { useState } from "react";

export default function TextInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoFocus = false,
  required = false,
  readOnly = false,
  disabled = false,
  inputClassName = "",
  autoComplete,
  passwordToggle = false,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const inputType =
    passwordToggle && type === "password"
      ? showPassword
        ? "text"
        : "password"
      : type;

  const inputClass = `w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] ${passwordToggle ? "pl-3 pr-10" : "px-3"} ${readOnly || disabled ? "cursor-default opacity-90" : ""} ${inputClassName}`;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      {passwordToggle && type === "password" ? (
        <div className="relative">
          <input
            type={inputType}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            autoFocus={autoFocus}
            required={required}
            readOnly={readOnly}
            disabled={disabled}
            autoComplete={autoComplete}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((v) => !v)}
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-[var(--muted)] hover:bg-[var(--surfaceMuted)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-50"
          >
            {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        <input
          type={inputType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          required={required}
          readOnly={readOnly}
          disabled={disabled}
          autoComplete={autoComplete}
          className={inputClass}
        />
      )}
    </label>
  );
}

function EyeIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
