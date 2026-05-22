import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useFinancialSupportReportsQuery } from "../../hook/useFinancialSupportInsights";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function errorMessage(error) {
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Failed to load reports.";
}

export default function FinancialSupportReportsPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [applied, setApplied] = useState({ from: today, to: today });

  const query = useFinancialSupportReportsQuery({
    from: applied.from,
    to: applied.to,
    enabled: true,
  });

  const summary = query.data?.summary || {
    depositsAmount: 0,
    depositsCount: 0,
    withdrawalsAmount: 0,
    withdrawalsCount: 0,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    heldCount: 0,
    completedCount: 0,
    netCashFlow: 0,
    transactionCount: 0,
  };
  const byDay = query.data?.byDay || [];

  function onApply(event) {
    event.preventDefault();
    setApplied({ from: fromDate, to: toDate });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Player wallet deposits and withdrawals for the selected period (up to 93
            days).
          </p>
        </div>

        <PanelCard className="p-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={onApply}>
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

        {query.isError ? (
          <PanelCard className="p-4">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {errorMessage(query.error)}
            </p>
          </PanelCard>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PanelCard className="p-4">
            <p className="text-xs text-(--muted)">Deposits</p>
            <p className="mt-1 text-lg font-semibold">{money(summary.depositsAmount)} ETB</p>
            <p className="mt-0.5 text-xs text-(--muted)">
              {Number(summary.depositsCount || 0).toLocaleString()} transactions
            </p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs text-(--muted)">Withdrawals</p>
            <p className="mt-1 text-lg font-semibold">
              {money(summary.withdrawalsAmount)} ETB
            </p>
            <p className="mt-0.5 text-xs text-(--muted)">
              {Number(summary.withdrawalsCount || 0).toLocaleString()} transactions
            </p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs text-(--muted)">Net cash flow</p>
            <p className="mt-1 text-lg font-semibold">
              {money(summary.netCashFlow)} ETB
            </p>
            <p className="mt-0.5 text-xs text-(--muted)">
              Deposits minus withdrawals
            </p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs text-(--muted)">Rows in range</p>
            <p className="mt-1 text-lg font-semibold">
              {Number(summary.transactionCount || 0).toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-(--muted)">
              All player wallet movements
            </p>
          </PanelCard>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <PanelCard className="p-3">
            <p className="text-xs text-(--muted)">Pending</p>
            <p className="mt-0.5 text-base font-semibold">
              {Number(summary.pendingCount || 0).toLocaleString()}
            </p>
          </PanelCard>
          <PanelCard className="p-3">
            <p className="text-xs text-(--muted)">Approved</p>
            <p className="mt-0.5 text-base font-semibold">
              {Number(summary.approvedCount || 0).toLocaleString()}
            </p>
          </PanelCard>
          <PanelCard className="p-3">
            <p className="text-xs text-(--muted)">Rejected</p>
            <p className="mt-0.5 text-base font-semibold">
              {Number(summary.rejectedCount || 0).toLocaleString()}
            </p>
          </PanelCard>
          <PanelCard className="p-3">
            <p className="text-xs text-(--muted)">Held</p>
            <p className="mt-0.5 text-base font-semibold">
              {Number(summary.heldCount || 0).toLocaleString()}
            </p>
          </PanelCard>
          <PanelCard className="p-3">
            <p className="text-xs text-(--muted)">Completed</p>
            <p className="mt-0.5 text-base font-semibold">
              {Number(summary.completedCount || 0).toLocaleString()}
            </p>
          </PanelCard>
        </section>

        <PanelCard className="overflow-hidden p-0">
          <div className="border-b border-(--border) px-4 py-3">
            <h3 className="text-sm font-semibold">Daily breakdown</h3>
            <p className="mt-0.5 text-xs text-(--muted)">
              One row per calendar day in the selected range.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-(--border) bg-(--surface-2) text-xs text-(--muted)">
                <tr>
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Deposits</th>
                  <th className="px-4 py-2 font-medium">Withdrawals</th>
                  <th className="px-4 py-2 font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-(--muted)">
                      Loading…
                    </td>
                  </tr>
                ) : byDay.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-(--muted)">
                      No days in range.
                    </td>
                  </tr>
                ) : (
                  byDay.map((row) => (
                    <tr
                      key={row.date}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td className="px-4 py-2.5">{row.dayLabel}</td>
                      <td className="px-4 py-2.5 text-(--muted)">{row.date}</td>
                      <td className="px-4 py-2.5">
                        {money(row.depositsAmount)}
                        <span className="ml-1 text-xs text-(--muted)">
                          ({Number(row.depositsCount || 0).toLocaleString()})
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {money(row.withdrawalsAmount)}
                        <span className="ml-1 text-xs text-(--muted)">
                          ({Number(row.withdrawalsCount || 0).toLocaleString()})
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        {money(row.netCashFlow)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </div>
    </AdminShell>
  );
}
