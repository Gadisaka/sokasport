import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAgentGamesQuery } from "../../hook/useAgentOperations";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AgentGamesPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ date: today, status: "" });

  const query = useAgentGamesQuery({
    page,
    limit: 15,
    date: applied.date,
    status: applied.status,
    enabled: true,
  });

  const items = Array.isArray(query.data?.items) ? query.data.items : [];
  const totalPages = Number(query.data?.totalPages || 1);

  function onApply(event) {
    event.preventDefault();
    setPage(1);
    setApplied({ date, status });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Games</h2>
          <p className="mt-1 text-sm text-(--muted)">
            View fixtures and current match status for your ticket monitoring.
          </p>
        </div>

        <PanelCard className="p-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={onApply}>
            <label className="text-xs text-(--muted)">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              />
            </label>
            <label className="text-xs text-(--muted)">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              >
                <option value="">All</option>
                <option value="NOT_STARTED">Not Started</option>
                <option value="LIVE">Live</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="FINISHED">Finished</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-sm bg-(--accent) px-3 py-2 text-xs font-semibold text-white"
            >
              Apply
            </button>
          </form>
        </PanelCard>

        <PanelCard className="overflow-x-auto">
          {query.isError ? (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
              Failed to load games.
            </div>
          ) : null}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                <th className="px-4 py-3 font-semibold">Match</th>
                <th className="px-4 py-3 font-semibold">League</th>
                <th className="px-4 py-3 font-semibold">Kickoff</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Odds</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                    Loading games...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                    No games found for this filter.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-(--border)/60">
                    <td className="px-4 py-3">
                      {item.home_team} vs {item.away_team}
                    </td>
                    <td className="px-4 py-3">{item.league?.name || "-"}</td>
                    <td className="px-4 py-3">{formatDateTime(item.start_time)}</td>
                    <td className="px-4 py-3">{item.status}</td>
                    <td className="px-4 py-3">{item._count?.odds ?? 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-(--border) px-4 py-3 text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-(--muted)">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
        </PanelCard>
      </div>
    </AdminShell>
  );
}
