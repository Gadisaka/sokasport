import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useFinancialSupportDashboardQuery } from "../../hook/useFinancialSupportInsights";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function FinancialSupportDashboardPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [applied, setApplied] = useState({ from: today, to: today });

  const query = useFinancialSupportDashboardQuery({
    from: applied.from,
    to: applied.to,
    enabled: true,
  });

  const summary = query.data?.summary || {
    depositsAmount: 0,
    depositsCount: 0,
    withdrawalsAmount: 0,
    withdrawalsCount: 0,
    pendingWithdrawalsAmount: 0,
    pendingWithdrawalsCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    heldCount: 0,
    netCashFlow: 0,
  };
  const cashflowLast7Days = query.data?.cashflowLast7Days || [];
  const pendingWithdrawals = query.data?.pendingWithdrawals || [];
  const recentFinanceActions = query.data?.recentActivity || [];
  const maxCashflow = Math.max(
    1,
    ...cashflowLast7Days.map((item) =>
      Math.max(Number(item.deposits || 0), Number(item.withdrawals || 0)),
    ),
  );

  const topStats = [
    {
      label: "Deposits",
      value: `${money(summary.depositsAmount)} ETB`,
      trend: `${Number(summary.depositsCount || 0).toLocaleString()} transactions`,
      tone: "good",
    },
    {
      label: "Withdrawals",
      value: `${money(summary.withdrawalsAmount)} ETB`,
      trend: `${Number(summary.withdrawalsCount || 0).toLocaleString()} transactions`,
      tone: "neutral",
    },
    {
      label: "Pending Withdrawals",
      value: `${money(summary.pendingWithdrawalsAmount)} ETB`,
      trend: `${Number(summary.pendingWithdrawalsCount || 0).toLocaleString()} waiting`,
      tone: "warn",
    },
    {
      label: "Approved",
      value: Number(summary.approvedCount || 0).toLocaleString(),
      trend: "Request approvals in selected range",
      tone: "good",
    },
    {
      label: "Rejected",
      value: Number(summary.rejectedCount || 0).toLocaleString(),
      trend: "Rejected requests in selected range",
      tone: "warn",
    },
    {
      label: "Wallet Holds",
      value: Number(summary.heldCount || 0).toLocaleString(),
      trend: "Held requests in selected range",
      tone: "warn",
    },
    {
      label: "Net Cash Flow",
      value: `${money(summary.netCashFlow)} ETB`,
      trend: "Deposits minus withdrawals",
      tone: summary.netCashFlow >= 0 ? "good" : "danger",
    },
  ];

  function applyDateFilters(event) {
    event.preventDefault();
    setApplied({ from: fromDate, to: toDate });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Financial Support Dashboard</h2>
            <p className="mt-1 text-sm text-(--muted)">
              Monitor player wallet deposits, withdrawals, pending queue, and recent finance activity.
            </p>
          </div>
          <p className="text-xs uppercase tracking-wide text-(--muted)">
            Updated {formatDateTime(query.data?.generatedAt)} • ETB
          </p>
        </div>

        <PanelCard className="p-4">
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

        {query.isError ? (
          <PanelCard className="p-4">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              Failed to load dashboard data.
            </p>
          </PanelCard>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {topStats.map((stat) => (
            <PanelCard key={stat.label} className="p-4">
              <p className="text-xs uppercase tracking-wide text-(--muted)">{stat.label}</p>
              <p className="mt-2 text-xl font-semibold">{stat.value}</p>
              <p
                className={`mt-2 text-xs ${
                  stat.tone === "good"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : stat.tone === "danger"
                      ? "text-rose-600 dark:text-rose-400"
                      : stat.tone === "warn"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-(--muted)"
                }`}
              >
                {stat.trend}
              </p>
            </PanelCard>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <PanelCard className="xl:col-span-2 p-5">
            <h3 className="text-base font-semibold">Deposits vs Withdrawals (Last 7 Days)</h3>
            <div className="mt-4 space-y-3">
              {query.isLoading ? (
                <p className="text-sm text-(--muted)">Loading chart...</p>
              ) : cashflowLast7Days.length === 0 ? (
                <p className="text-sm text-(--muted)">No chart data in this period.</p>
              ) : (
                cashflowLast7Days.map((item) => (
                  <div key={item.day} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-(--muted)">
                      <span className="uppercase">{item.day}</span>
                      <span>
                        D {money(item.deposits)} ETB • W {money(item.withdrawals)} ETB
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-(--surfaceMuted)">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{
                          width: `${Math.max((Number(item.deposits || 0) / maxCashflow) * 100, 8)}%`,
                        }}
                      />
                    </div>
                    <div className="h-2 rounded-full bg-(--surfaceMuted)">
                      <div
                        className="h-2 rounded-full bg-amber-500"
                        style={{
                          width: `${Math.max((Number(item.withdrawals || 0) / maxCashflow) * 100, 8)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </PanelCard>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <PanelCard className="overflow-x-auto">
            <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Pending Withdrawals Queue</h3>
              <span className="text-xs uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Needs action
              </span>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Request</th>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                      Loading queue...
                    </td>
                  </tr>
                ) : pendingWithdrawals.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                      No pending withdrawals in this dataset.
                    </td>
                  </tr>
                ) : (
                  pendingWithdrawals.map((item) => (
                    <tr key={item.id} className="border-b border-(--border)/60">
                      <td className="px-4 py-3 font-medium">{item.id}</td>
                      <td className="px-4 py-3">
                        {item.userName}
                        {item.userPhone ? (
                          <span className="ml-2 text-xs text-(--muted)">
                            ({item.userPhone})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{money(item.amount)} ETB</td>
                      <td className="px-4 py-3">{formatDateTime(item.requestedAt)}</td>
                      <td className="px-4 py-3">{item.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>

          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Recent Financial Support Activity</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                      Loading activity...
                    </td>
                  </tr>
                ) : recentFinanceActions.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={5}>
                      No activity found in this period.
                    </td>
                  </tr>
                ) : (
                  recentFinanceActions.map((item) => (
                    <tr key={item.id} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{formatDateTime(item.time)}</td>
                      <td className="px-4 py-3">
                        {item.userName}
                        {item.userPhone ? (
                          <span className="ml-2 text-xs text-(--muted)">
                            ({item.userPhone})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{item.action}</td>
                      <td className="px-4 py-3">{money(item.amount)} ETB</td>
                      <td className="px-4 py-3">{item.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>
        </section>
      </div>
    </AdminShell>
  );
}
