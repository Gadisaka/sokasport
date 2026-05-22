import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAgentCashiersQuery } from "../../hook/useAgentInsights";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

export default function AgentCashiersPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [appliedDates, setAppliedDates] = useState({ from: today, to: today });
  const [branch, setBranch] = useState("all");

  const query = useAgentCashiersQuery({
    from: appliedDates.from,
    to: appliedDates.to,
    branchName: branch,
  });

  const branches = useMemo(() => {
    const options = query.data?.branches ?? [];
    return [{ id: "all", name: "All Branches" }].concat(
      options.map((name) => ({ id: name, name })),
    );
  }, [query.data?.branches]);

  const rows = query.data?.items ?? [];

  function applyDateFilters(event) {
    event.preventDefault();
    setAppliedDates({ from: fromDate, to: toDate });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Cashiers</h2>
            <p className="mt-1 text-sm text-(--muted)">
              Oversight for your assigned cashiers by branch.
            </p>
          </div>
        </div>

        <PanelCard className="p-4 space-y-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-(--muted)">
              Branch
            </p>
            <div className="inline-flex rounded-sm border border-(--border) bg-(--surfaceMuted) p-1">
              {branches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setBranch(item.id)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                    branch === item.id
                      ? "bg-(--accent) text-white"
                      : "text-(--muted) hover:text-(--text)"
                  }`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <form className="flex flex-wrap items-end gap-3" onSubmit={applyDateFilters}>
            <label className="text-xs text-(--muted)">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              />
            </label>
            <label className="text-xs text-(--muted)">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              />
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
              Failed to load cashiers data.
            </div>
          ) : null}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                <th className="px-4 py-3 font-semibold">Cashier</th>
                <th className="px-4 py-3 font-semibold">Branch</th>
                <th className="px-4 py-3 font-semibold">Wallet balance</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Tickets</th>
                <th className="px-4 py-3 font-semibold">Volume</th>
                <th className="px-4 py-3 font-semibold">Pending</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    Loading cashiers...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    No assigned cashiers found for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.cashierProfileId} className="border-b border-(--border)/60">
                    <td className="px-4 py-3">{row.cashierName}</td>
                    <td className="px-4 py-3">{row.branchName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {Number(row.walletBalance ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ETB
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        row.status === "ACTIVE"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-(--muted)"
                      }`}
                    >
                      {row.status}
                    </td>
                    <td className="px-4 py-3">{row.tickets}</td>
                    <td className="px-4 py-3">{row.volume.toLocaleString()} ETB</td>
                    <td className="px-4 py-3">{row.pending}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PanelCard>
      </div>
    </AdminShell>
  );
}
