import ThemeToggleButton from "../ui/ThemeToggleButton";

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-dvh bg-[var(--bgApp)] px-4 py-10 text-[var(--text)]">
      <div className="mx-auto mb-6 flex w-full max-w-md justify-end">
        <ThemeToggleButton />
      </div>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}
