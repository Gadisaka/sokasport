import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAgentReportsQuery } from "../../hook/useAgentOperations";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function number(value) {
  return Number(value || 0);
}

export default function AgentReportsPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [branchName, setBranchName] = useState("all");
  const [applied, setApplied] = useState({
    fromDate: today,
    toDate: today,
    branchName: "all",
  });

  const query = useAgentReportsQuery({
    from: applied.fromDate,
    to: applied.toDate,
    branchName: applied.branchName,
    enabled: true,
  });

  const branches = useMemo(
    () =>
      [{ id: "all", name: "All branches" }].concat(
        (query.data?.branches || []).map((name) => ({ id: name, name })),
      ),
    [query.data?.branches],
  );

  const summary = query.data?.summary || {
    totalTickets: 0,
    totalStake: 0,
    averageStake: 0,
    openTickets: 0,
    wonTickets: 0,
    lostTickets: 0,
    paidTickets: 0,
  };
  const byBranch = query.data?.byBranch || [];
  const byCashier = query.data?.byCashier || [];

  function onApply(event) {
    event.preventDefault();
    setApplied({ fromDate, toDate, branchName });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Agent report summary for tickets and stakes across assigned cashiers.
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
            <label className="text-xs text-(--muted)">
              Branch
              <select
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
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

        {query.isError ? (
          <PanelCard className="p-4">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              Failed to load reports.
            </p>
          </PanelCard>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PanelCard className="p-4">
            <p className="text-xs uppercase tracking-wide text-(--muted)">Total Tickets</p>
            <p className="mt-2 text-xl font-semibold">{number(summary.totalTickets).toLocaleString()}</p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs uppercase tracking-wide text-(--muted)">Total Stake</p>
            <p className="mt-2 text-xl font-semibold">
              {number(summary.totalStake).toLocaleString()} ETB
            </p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs uppercase tracking-wide text-(--muted)">Average Stake</p>
            <p className="mt-2 text-xl font-semibold">
              {number(summary.averageStake).toLocaleString()} ETB
            </p>
          </PanelCard>
          <PanelCard className="p-4">
            <p className="text-xs uppercase tracking-wide text-(--muted)">Open / Won / Lost</p>
            <p className="mt-2 text-xl font-semibold">
              {number(summary.openTickets)} / {number(summary.wonTickets)} / {number(summary.lostTickets)}
            </p>
          </PanelCard>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">By Branch</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 font-semibold">Tickets</th>
                  <th className="px-4 py-3 font-semibold">Stake</th>
                  <th className="px-4 py-3 font-semibold">Open</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      Loading report...
                    </td>
                  </tr>
                ) : byBranch.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      No branch report data in this filter.
                    </td>
                  </tr>
                ) : (
                  byBranch.map((item) => (
                    <tr key={item.branchName} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{item.branchName}</td>
                      <td className="px-4 py-3">{number(item.tickets).toLocaleString()}</td>
                      <td className="px-4 py-3">{number(item.stake).toLocaleString()} ETB</td>
                      <td className="px-4 py-3">{number(item.open).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PanelCard>

          <PanelCard className="overflow-x-auto">
            <div className="border-b border-(--border) px-4 py-3">
              <h3 className="text-base font-semibold">By Cashier</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                  <th className="px-4 py-3 font-semibold">Cashier</th>
                  <th className="px-4 py-3 font-semibold">Tickets</th>
                  <th className="px-4 py-3 font-semibold">Stake</th>
                  <th className="px-4 py-3 font-semibold">Paid</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      Loading report...
                    </td>
                  </tr>
                ) : byCashier.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                      No cashier report data in this filter.
                    </td>
                  </tr>
                ) : (
                  byCashier.map((item) => (
                    <tr key={item.cashierProfileId} className="border-b border-(--border)/60">
                      <td className="px-4 py-3">{item.cashierName}</td>
                      <td className="px-4 py-3">{number(item.tickets).toLocaleString()}</td>
                      <td className="px-4 py-3">{number(item.stake).toLocaleString()} ETB</td>
                      <td className="px-4 py-3">{number(item.paid).toLocaleString()}</td>
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
