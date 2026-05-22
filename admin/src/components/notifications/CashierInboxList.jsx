import {
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "../../hook/useNotifications";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function CashierInboxList() {
  const notificationsQuery = useNotificationsQuery({ page: 1, limit: 30 });
  const markRead = useMarkNotificationReadMutation();

  const items = Array.isArray(notificationsQuery.data?.items)
    ? notificationsQuery.data.items
    : [];

  if (notificationsQuery.isLoading) {
    return <p className="py-6 text-sm text-[var(--muted)]">Loading messages…</p>;
  }

  if (notificationsQuery.isError) {
    return (
      <p className="py-6 text-sm text-[var(--danger)]">
        {notificationsQuery.error?.message || "Failed to load messages"}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-6 text-sm text-[var(--muted)]">
        No messages from the company yet.
      </p>
    );
  }

  return (
    <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
      {items.map((n) => {
        const unread = !n.readAt;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (unread) markRead.mutate(n.id);
              }}
              className={`w-full rounded-sm border px-3 py-2.5 text-left transition ${
                unread
                  ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--panel-2)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text)]">
                  {n.title}
                </span>
                {unread ? (
                  <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    New
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                {n.body}
              </p>
              <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                {formatWhen(n.createdAt)}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
