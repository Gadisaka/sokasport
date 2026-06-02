import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAgentDashboardQuery } from "../../hook/useAgentInsights";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

export default function AgentDashboardPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [appliedDates, setAppliedDates] = useState({ from: today, to: today });

  const query = useAgentDashboardQuery({
    from: appliedDates.from,
    to: appliedDates.to,
    branchName: selectedBranch,
  });

  const summary = query.data?.summary ?? {
    assignedBranches: 0,
    cashiers: 0,
    openShift: 0,
    tickets: 0,
    volume: 0,
    pendingSettlement: 0,
    liveTickets: 0,
  };

  const topStats = [
    { label: "Assigned Branches", value: summary.assignedBranches.toString(), trend: "Managed by agent", tone: "good" },
    { label: "Cashiers", value: summary.cashiers.toString(), trend: `${summary.openShift} active`, tone: "good" },
    { label: "Tickets", value: summary.tickets.toLocaleString(), trend: "Within selected filter", tone: "neutral" },
    { label: "Ticket Volume", value: `${summary.volume.toLocaleString()} ETB`, trend: "Shop-only volume", tone: "good" },
    { label: "Pending Settlements", value: summary.pendingSettlement.toString(), trend: "Needs cashier action", tone: "warn" },
    { label: "Live Tickets", value: summary.liveTickets.toString(), trend: "Recent ticket stream", tone: "neutral" },
  ];

  const wonToday = query.data?.wonToday ?? { tickets: 0, payable: 0 };
  const wonYesterday = query.data?.wonYesterday ?? { tickets: 0, payable: 0 };

  const wonStats = [
    { label: "Won Tickets (Today)", value: Number(wonToday.tickets || 0).toLocaleString() },
    { label: "Payable (Today)", value: `${Number(wonToday.payable || 0).toLocaleString()} ETB` },
    { label: "Won Tickets (Yesterday)", value: Number(wonYesterday.tickets || 0).toLocaleString() },
    { label: "Payable (Yesterday)", value: `${Number(wonYesterday.payable || 0).toLocaleString()} ETB` },
  ];

  const branches = useMemo(
    () => [{ id: "all", name: "All" }].concat((query.data?.branches ?? []).map((name) => ({ id: name, name }))),
    [query.data?.branches],
  );

  const activityByHour = query.data?.activityByHour ?? [];
  const liveTickets = query.data?.liveTickets ?? [];
  const cashierPerformance = query.data?.cashierPerformance ?? [];
  const branchSummary = query.data?.branchSummary ?? [];
  const alerts = query.data?.alerts ?? [];
  const recentActions = query.data?.recentActions ?? [];

  const maxHourlyTickets = Math.max(
    1,
    ...activityByHour.map((item) => Number(item.tickets || 0)),
  );

  function applyDateFilters(event) {
    event.preventDefault();
    setAppliedDates({ from: fromDate, to: toDate });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Agent Dashboard</h2>
            <p className="mt-1 text-sm text-(--muted)">
              Branch and cashier operations overview. This dashboard tracks shop activity only.
            </p>
          </div>
          <p className="text-xs uppercase tracking-wide text-(--muted)">
            Updated {formatDateTime(query.data?.generatedAt)} • ETB
          </p>
        </div>

        <PanelCard className="p-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-(--muted)">Branch Filter</p>
              <div className="inline-flex rounded-sm border border-(--border) bg-(--surfaceMuted) p-1">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => setSelectedBranch(branch.id)}
                    className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                      selectedBranch === branch.id
                        ? "bg-(--accent) text-white"
                        : "text-(--muted) hover:text-(--text)"
                    }`}
                  >
                    {branch.name}
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
          </div>
        </PanelCard>

        {query.isError ? (
          <PanelCard className="p-4">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              Failed to load dashboard data.
            </p>
          </PanelCard>
        ) : null}

        {query.isLoading ? (
          <PanelCard className="p-4">
            <p className="text-sm text-(--muted)">Loading dashboard...</p>
          </PanelCard>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {topStats.map((stat) => (
            <PanelCard key={stat.label} className="p-4">
              <p className="text-xs uppercase tracking-wide text-(--muted)">{stat.label}</p>
              <p className="mt-2 text-xl font-semibold">{stat.value}</p>
              <p
                className={`mt-2 text-xs ${
                  stat.tone === "good"
                    ? "text-emerald-600 dark:text-emerald-400"
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

        <section>
          <p className="mb-3 text-xs uppercase tracking-wide text-(--muted)">
            Winning Tickets (Today / Yesterday)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {wonStats.map((stat) => (
              <PanelCard key={stat.label} className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">{stat.label}</p>
                <p className="mt-2 text-xl font-semibold">{stat.value}</p>
              </PanelCard>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <PanelCard className="xl:col-span-2 p-5">
            <h3 className="text-base font-semibold">Shop Ticket Volume by Hour</h3>
            <div className="mt-4 space-y-3">
              {activityByHour.length === 0 ? (
                <p className="text-sm text-(--muted)">No activity in this filter.</p>
              ) : (
                activityByHour.map((item) => (
                  <div key={item.hour} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3">
                    <span className="text-xs uppercase text-(--muted)">{item.hour}</span>
                    <div className="h-2 rounded-full bg-(--surfaceMuted)">
                      <div
                        className="h-2 rounded-full bg-(--accent)"
                        style={{
                          width: `${Math.max((Number(item.tickets || 0) / maxHourlyTickets) * 100, 8)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-(--muted)">{item.tickets} tickets</span>
                  </div>
                ))
              )}
            </div>
          </PanelCard>

          <PanelCard className="overflow-hidden">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Live Shop Tickets</h3>
            </div>
            <div className="space-y-0.5 p-2">
              {liveTickets.length === 0 ? (
                <p className="px-3 py-2 text-sm text-(--muted)">No recent tickets found.</p>
              ) : (
                liveTickets.map((item) => (
                  <div key={item.id} className="rounded-sm px-3 py-2 hover:bg-(--surfaceMuted)">
                    <p className="text-xs text-(--muted)">
                      {formatTime(item.createdAt)} • {item.cashierName}
                    </p>
                    <p className="text-sm">{item.couponNumber}</p>
                    <p className="text-xs text-(--muted)">
                      Stake • <span className="font-semibold text-(--text)">{item.stake.toLocaleString()} ETB</span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </PanelCard>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Cashier Performance</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Cashier</th>
                  <th className="px-4 py-3 font-semibold">Tickets</th>
                  <th className="px-4 py-3 font-semibold">Volume</th>
                  <th className="px-4 py-3 font-semibold">Pending</th>
                </tr>
              </thead>
              <tbody>
                {cashierPerformance.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      No cashier performance data in this filter.
                    </td>
                  </tr>
                ) : (
                  cashierPerformance.map((item) => (
                    <tr key={item.cashierProfileId} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{item.cashierName}</td>
                      <td className="px-4 py-3">{item.tickets}</td>
                      <td className="px-4 py-3">{item.volume.toLocaleString()} ETB</td>
                      <td className="px-4 py-3">{item.pending}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>

          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Branch Summary</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 font-semibold">Cashiers</th>
                  <th className="px-4 py-3 font-semibold">Tickets</th>
                  <th className="px-4 py-3 font-semibold">Volume</th>
                </tr>
              </thead>
              <tbody>
                {branchSummary.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      No branch summary data in this filter.
                    </td>
                  </tr>
                ) : (
                  branchSummary.map((item) => (
                    <tr key={item.branchName} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{item.branchName}</td>
                      <td className="px-4 py-3">{item.cashiers}</td>
                      <td className="px-4 py-3">{item.tickets}</td>
                      <td className="px-4 py-3">{item.volume.toLocaleString()} ETB</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <PanelCard className="p-5">
            <h3 className="text-base font-semibold">Risk & Monitoring Alerts</h3>
            <ul className="mt-3 space-y-2">
              {alerts.length === 0 ? (
                <li className="rounded-sm border border-(--border) bg-(--surfaceMuted) px-3 py-2 text-sm text-(--muted)">
                  No active alerts in this filter.
                </li>
              ) : (
                alerts.map((alert) => (
                  <li key={alert} className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    {alert}
                  </li>
                ))
              )}
            </ul>
          </PanelCard>

          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">Recent Agent Activity</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentActions.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={2}>
                      No recent activity found.
                    </td>
                  </tr>
                ) : (
                  recentActions.map((item) => (
                    <tr key={item.id} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{formatTime(item.createdAt)}</td>
                      <td className="px-4 py-3">{item.action}</td>
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
