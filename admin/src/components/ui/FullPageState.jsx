export default function FullPageState({ text = "Loading..." }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bgApp)] px-4 text-sm font-medium text-[var(--muted)]">
      {text}
    </div>
  );
}
