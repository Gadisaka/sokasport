import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { ROLE_LABELS } from "../../constants/auth";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAdminDashboardInsightsQuery } from "../../hook/useAdminInsights";

const DASHBOARD_ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN"];

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function statusTone(status) {
  if (status === "PAID" || status === "WON") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "LOST" || status === "VOID" || status === "CANCELED") {
    return "text-rose-600 dark:text-rose-400";
  }
  return "text-(--muted)";
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const canViewDashboard = DASHBOARD_ALLOWED_ROLES.includes(user?.role);
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [applied, setApplied] = useState({ from: today, to: today });

  const query = useAdminDashboardInsightsQuery({
    from: applied.from,
    to: applied.to,
    enabled: canViewDashboard,
  });

  const summary = query.data?.summary || {
    totalUsers: 0,
    activeUsers: 0,
    newUsersInRange: 0,
    activeCashiers: 0,
    activeAgents: 0,
    totalTickets: 0,
    openTickets: 0,
    paidTickets: 0,
    settledTickets: 0,
    totalStake: 0,
    totalPotentialWin: 0,
    totalPayout: 0,
    platformProfit: 0,
    payoutCount: 0,
    depositsAmount: 0,
    withdrawalsAmount: 0,
    pendingWithdrawalsAmount: 0,
    pendingWithdrawalsCount: 0,
    netCashFlow: 0,
  };
  const ticketVolumeLast7Days = query.data?.ticketVolumeLast7Days || [];
  const byStatus = query.data?.byStatus || [];
  const topBranches = query.data?.topBranches || [];
  const recentTickets = query.data?.recentTickets || [];
  const recentWalletActivity = query.data?.recentWalletActivity || [];
  const recentAdminActivity = query.data?.recentAdminActivity || [];

  const maxStake = Math.max(
    1,
    ...ticketVolumeLast7Days.map((item) => Number(item.stake || 0)),
  );
  const maxProfitMagnitude = Math.max(
    1,
    ...ticketVolumeLast7Days.map((item) => Math.abs(Number(item.profit || 0))),
  );

  const topStats = [
    {
      label: "Total users",
      value: Number(summary.totalUsers || 0).toLocaleString(),
      meta: `${Number(summary.activeUsers || 0).toLocaleString()} active`,
    },
    {
      label: "New users",
      value: Number(summary.newUsersInRange || 0).toLocaleString(),
      meta: "Created in selected range",
    },
    {
      label: "Tickets",
      value: Number(summary.totalTickets || 0).toLocaleString(),
      meta: `${Number(summary.openTickets || 0).toLocaleString()} not settled (open + printed)`,
    },
    {
      label: "Total wagered",
      value: `${money(summary.totalStake)} ETB`,
      meta: `${Number(summary.paidTickets || 0).toLocaleString()} paid tickets`,
    },
    {
      label: "Total payouts",
      value: `${money(summary.totalPayout)} ETB`,
      meta: `${Number(summary.payoutCount || 0).toLocaleString()} payout transactions`,
    },
    {
      label: "Platform profit",
      value: `${money(summary.platformProfit)} ETB`,
      meta: "Wagered minus payout",
    },
    {
      label: "Net cash flow",
      value: `${money(summary.netCashFlow)} ETB`,
      meta: "Player deposits minus withdrawals",
    },
    {
      label: "Pending withdrawals",
      value: `${money(summary.pendingWithdrawalsAmount)} ETB`,
      meta: `${Number(summary.pendingWithdrawalsCount || 0).toLocaleString()} pending`,
    },
  ];

  function onApply(event) {
    event.preventDefault();
    setApplied({ from: fromDate, to: toDate });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      {!canViewDashboard ? (
        <PanelCard className="max-w-xl p-8">
          <h2 className="text-2xl font-semibold">Dashboard restricted</h2>
          <p className="mt-3 text-sm text-(--muted)">
            Signed in as {ROLE_LABELS[user?.role] || user?.role}. This dashboard is currently
            available only for Admin and Super Admin roles.
          </p>
        </PanelCard>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Operations Dashboard</h2>
              <p className="mt-1 text-sm text-(--muted)">
                Real operational snapshot for {ROLE_LABELS[user?.role] || user?.role}.
              </p>
            </div>
          </div>

          <PanelCard className="p-4">
            <form className="flex flex-wrap items-end gap-3" onSubmit={onApply}>
              <label className="text-xs text-(--muted)">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
                />
              </label>
              <label className="text-xs text-(--muted)">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
                />
              </label>
              <button
                type="submit"
                className="rounded-sm bg-(--accent) px-3 py-2 text-xs font-semibold text-white"
              >
                Apply
              </button>
              <p className="text-xs text-(--muted)">
                Updated {formatDateTime(query.data?.generatedAt || null)}
              </p>
            </form>
          </PanelCard>

          {query.isError ? (
            <PanelCard className="p-4">
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {query.error?.message || "Failed to load dashboard insights."}
              </p>
            </PanelCard>
          ) : null}

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {topStats.map((item) => (
              <PanelCard key={item.label} className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">{item.label}</p>
                <p className="mt-1.5 text-xl font-semibold">{item.value}</p>
                <p className="mt-0.5 text-xs text-(--muted)">{item.meta}</p>
              </PanelCard>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <PanelCard className="p-5">
              <h3 className="text-base font-semibold">Ticket Volume (Last 7 Days)</h3>
              <div className="mt-4 space-y-3">
                {ticketVolumeLast7Days.map((item) => (
                  <div key={item.date} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3">
                    <span className="text-xs uppercase text-(--muted)">{item.day}</span>
                    <div className="h-2 rounded-full bg-(--surfaceMuted)">
                      <div
                        className="h-2 rounded-full bg-(--accent)"
                        style={{ width: `${Math.max((Number(item.stake || 0) / maxStake) * 100, 8)}%` }}
                      />
                    </div>
                    <span className="text-xs text-(--muted)">
                      {money(item.stake)} ETB ({Number(item.tickets || 0).toLocaleString()})
                    </span>
                  </div>
                ))}
              </div>
            </PanelCard>

            <PanelCard className="p-5">
              <h3 className="text-base font-semibold">Profit / Loss (Last 7 Days)</h3>
              <div className="mt-4 space-y-3">
                {ticketVolumeLast7Days.map((item) => {
                  const amount = Number(item.profit || 0);
                  return (
                    <div
                      key={`${item.date}-profit`}
                      className="grid grid-cols-[3rem_1fr_auto] items-center gap-3"
                    >
                      <span className="text-xs uppercase text-(--muted)">{item.day}</span>
                      <div className="h-2 rounded-full bg-(--surfaceMuted)">
                        <div
                          className={`h-2 rounded-full ${amount >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                          style={{
                            width: `${Math.max((Math.abs(amount) / maxProfitMagnitude) * 100, 8)}%`,
                          }}
                        />
                      </div>
                      <span className={`text-xs ${amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {amount >= 0 ? "+" : ""}
                        {money(amount)} ETB
                      </span>
                    </div>
                  );
                })}
              </div>
            </PanelCard>
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <PanelCard className="overflow-hidden">
              <div className="border-b border-(--border) px-4 py-3">
                <h3 className="text-base font-semibold">Ticket Status Breakdown</h3>
              </div>
              <div className="space-y-2 p-4">
                {query.isLoading ? (
                  <p className="text-sm text-(--muted)">Loading...</p>
                ) : byStatus.length === 0 ? (
                  <p className="text-sm text-(--muted)">No status data in this range.</p>
                ) : (
                  byStatus.map((row) => (
                    <div key={row.status} className="flex items-center justify-between text-sm">
                      <span className={statusTone(row.status)}>{row.status}</span>
                      <span className="font-semibold">{Number(row.count || 0).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </PanelCard>

            <PanelCard className="overflow-x-auto xl:col-span-2">
              <div className="border-b border-(--border) px-4 py-3">
                <h3 className="text-base font-semibold">Top Branches by Stake</h3>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                    <th className="px-4 py-3 font-semibold">Branch</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">Tickets</th>
                    <th className="px-4 py-3 font-semibold">Stake</th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-5 text-(--muted)">
                        Loading...
                      </td>
                    </tr>
                  ) : topBranches.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-5 text-(--muted)">
                        No branch data in this range.
                      </td>
                    </tr>
                  ) : (
                    topBranches.map((row) => (
                      <tr
                        key={`${row.branchName}-${row.branchLocation}`}
                        className="border-b border-(--border)/60"
                      >
                        <td className="px-4 py-3">{row.branchName}</td>
                        <td className="px-4 py-3 text-(--muted)">{row.branchLocation || "-"}</td>
                        <td className="px-4 py-3">{Number(row.tickets || 0).toLocaleString()}</td>
                        <td className="px-4 py-3">{money(row.stake)} ETB</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </PanelCard>
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <PanelCard className="overflow-x-auto">
              <div className="border-b border-(--border) px-4 py-3">
                <h3 className="text-base font-semibold">Recent Tickets</h3>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Coupon</th>
                    <th className="px-4 py-3 font-semibold">Branch</th>
                    <th className="px-4 py-3 font-semibold">Stake</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-5 text-(--muted)">
                        Loading...
                      </td>
                    </tr>
                  ) : recentTickets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-5 text-(--muted)">
                        No recent tickets in this range.
                      </td>
                    </tr>
                  ) : (
                    recentTickets.map((row) => (
                      <tr key={row.id} className="border-b border-(--border)/60">
                        <td className="px-4 py-3 text-(--muted)">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">{row.couponNumber}</td>
                        <td className="px-4 py-3">{row.branchName || "-"}</td>
                        <td className="px-4 py-3">{money(row.stake)} ETB</td>
                        <td className={`px-4 py-3 ${statusTone(row.status)}`}>{row.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </PanelCard>

            <PanelCard className="overflow-x-auto">
              <div className="border-b border-(--border) px-4 py-3">
                <h3 className="text-base font-semibold">Recent Player Wallet Activity</h3>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-5 text-(--muted)">
                        Loading...
                      </td>
                    </tr>
                  ) : recentWalletActivity.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-5 text-(--muted)">
                        No wallet activity found.
                      </td>
                    </tr>
                  ) : (
                    recentWalletActivity.map((row) => (
                      <tr key={row.id} className="border-b border-(--border)/60">
                        <td className="px-4 py-3 text-(--muted)">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">{row.userName}</td>
                        <td className="px-4 py-3">{row.type}</td>
                        <td className="px-4 py-3">{money(row.amount)} ETB</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </PanelCard>
          </section>

          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Recent Admin Activity</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Actor</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Module</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-5 text-(--muted)">
                      Loading...
                    </td>
                  </tr>
                ) : recentAdminActivity.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-5 text-(--muted)">
                      No admin activity found.
                    </td>
                  </tr>
                ) : (
                  recentAdminActivity.map((row) => (
                    <tr key={row.id} className="border-b border-(--border)/60">
                      <td className="px-4 py-3 text-(--muted)">{formatDateTime(row.createdAt)}</td>
                      <td className="px-4 py-3">{row.actorName}</td>
                      <td className="px-4 py-3">{row.action}</td>
                      <td className="px-4 py-3">{row.module}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>
        </div>
      )}
    </AdminShell>
  );
}
