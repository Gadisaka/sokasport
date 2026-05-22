import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import {
  useAdminAgentsForReportsQuery,
  useAdminCashiersForReportsQuery,
  useAdminFinanceReportsQuery,
  useAdminSalesReportsQuery,
} from "../../hook/useAdminInsights";

const TABS = [
  { key: "wallet", label: "Wallet activity" },
  { key: "sales", label: "Sales (tickets)" },
];

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function number(value) {
  return Number(value || 0);
}

function errorMessage(error) {
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Failed to load reports.";
}

export default function AdminReportsPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [activeTab, setActiveTab] = useState("wallet");

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [appliedWallet, setAppliedWallet] = useState({ from: today, to: today });
  const [appliedSales, setAppliedSales] = useState({
    from: today,
    to: today,
    agentId: "",
    cashierProfileId: "",
  });

  const [agentIdDraft, setAgentIdDraft] = useState("");
  const [cashierIdDraft, setCashierIdDraft] = useState("");

  const financeQuery = useAdminFinanceReportsQuery({
    from: appliedWallet.from,
    to: appliedWallet.to,
    enabled: activeTab === "wallet",
  });

  const salesQuery = useAdminSalesReportsQuery({
    from: appliedSales.from,
    to: appliedSales.to,
    agentId: appliedSales.agentId,
    cashierProfileId: appliedSales.cashierProfileId,
    enabled: activeTab === "sales",
  });

  const agentsQuery = useAdminAgentsForReportsQuery({
    enabled: activeTab === "sales",
  });

  const cashiersQuery = useAdminCashiersForReportsQuery({
    enabled: activeTab === "sales" && !agentIdDraft,
  });

  const agents = agentsQuery.data || [];

  const cashierOptions = useMemo(() => {
    if (agentIdDraft) {
      const agent = agents.find((a) => a.id === agentIdDraft);
      const list = agent?.cashiers || [];
      return list.map((c) => ({
        value: c.cashierProfileId,
        label: `${c.name} · ${c.branchName || "—"}`,
      }));
    }
    const list = cashiersQuery.data || [];
    return list
      .filter((c) => c.cashierProfileId)
      .map((c) => ({
        value: c.cashierProfileId,
        label: `${c.name} · ${c.branch?.name || "—"}`,
      }));
  }, [agentIdDraft, agents, cashiersQuery.data]);

  useEffect(() => {
    if (!cashierIdDraft || !agentIdDraft) return;
    const ok = cashierOptions.some((o) => o.value === cashierIdDraft);
    if (!ok) setCashierIdDraft("");
  }, [agentIdDraft, cashierOptions, cashierIdDraft]);

  const financeSummary = financeQuery.data?.summary || {
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
  const financeByDay = financeQuery.data?.byDay || [];

  const salesSummary = salesQuery.data?.summary || {
    totalTickets: 0,
    totalStake: 0,
    averageStake: 0,
    openTickets: 0,
    wonTickets: 0,
    lostTickets: 0,
    paidTickets: 0,
  };
  const salesByDay = salesQuery.data?.byDay || [];
  const salesByBranch = salesQuery.data?.byBranch || [];
  const salesByCashier = salesQuery.data?.byCashier || [];

  function setTab(next) {
    if (next === "wallet") {
      setFromDate(appliedWallet.from);
      setToDate(appliedWallet.to);
    } else {
      setFromDate(appliedSales.from);
      setToDate(appliedSales.to);
      setAgentIdDraft(appliedSales.agentId);
      setCashierIdDraft(appliedSales.cashierProfileId);
    }
    setActiveTab(next);
  }

  function onApply(event) {
    event.preventDefault();
    if (activeTab === "wallet") {
      setAppliedWallet({ from: fromDate, to: toDate });
    } else {
      setAppliedSales({
        from: fromDate,
        to: toDate,
        agentId: agentIdDraft,
        cashierProfileId: cashierIdDraft,
      });
    }
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Wallet movements and ticket sales for the selected period (up to 93 days).
          </p>
        </div>

        <div className="flex gap-1 border-b border-(--border)">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              className={`border-b-2 px-4 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? "border-(--accent) text-(--accent)"
                  : "border-transparent text-(--muted)"
              }`}
            >
              {tab.label}
            </button>
          ))}
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
            {activeTab === "sales" ? (
              <>
                <label className="text-xs text-(--muted)">
                  Agent
                  <select
                    value={agentIdDraft}
                    onChange={(e) => setAgentIdDraft(e.target.value)}
                    className="mt-1 block min-w-40 rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
                  >
                    <option value="">All agents</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-(--muted)">
                  Cashier
                  <select
                    value={cashierIdDraft}
                    onChange={(e) => setCashierIdDraft(e.target.value)}
                    disabled={
                      agentsQuery.isLoading ||
                      (!agentIdDraft && cashiersQuery.isLoading)
                    }
                    className="mt-1 block min-w-48 rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text) disabled:opacity-60"
                  >
                    <option value="">All cashiers</option>
                    {cashierOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <button
              type="submit"
              className="rounded-sm bg-(--accent) px-3 py-2 text-xs font-semibold text-white"
            >
              Apply
            </button>
          </form>
        </PanelCard>

        {activeTab === "wallet" ? (
          <>
            {financeQuery.isError ? (
              <PanelCard className="p-4">
                <p className="text-sm text-rose-600 dark:text-rose-400">
                  {errorMessage(financeQuery.error)}
                </p>
              </PanelCard>
            ) : null}

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PanelCard className="p-4">
                <p className="text-xs text-(--muted)">Deposits</p>
                <p className="mt-1 text-lg font-semibold">
                  {money(financeSummary.depositsAmount)} ETB
                </p>
                <p className="mt-0.5 text-xs text-(--muted)">
                  {Number(financeSummary.depositsCount || 0).toLocaleString()}{" "}
                  transactions
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs text-(--muted)">Withdrawals</p>
                <p className="mt-1 text-lg font-semibold">
                  {money(financeSummary.withdrawalsAmount)} ETB
                </p>
                <p className="mt-0.5 text-xs text-(--muted)">
                  {Number(financeSummary.withdrawalsCount || 0).toLocaleString()}{" "}
                  transactions
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs text-(--muted)">Net cash flow</p>
                <p className="mt-1 text-lg font-semibold">
                  {money(financeSummary.netCashFlow)} ETB
                </p>
                <p className="mt-0.5 text-xs text-(--muted)">
                  Deposits minus withdrawals
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs text-(--muted)">Rows in range</p>
                <p className="mt-1 text-lg font-semibold">
                  {Number(financeSummary.transactionCount || 0).toLocaleString()}
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
                  {Number(financeSummary.pendingCount || 0).toLocaleString()}
                </p>
              </PanelCard>
              <PanelCard className="p-3">
                <p className="text-xs text-(--muted)">Approved</p>
                <p className="mt-0.5 text-base font-semibold">
                  {Number(financeSummary.approvedCount || 0).toLocaleString()}
                </p>
              </PanelCard>
              <PanelCard className="p-3">
                <p className="text-xs text-(--muted)">Rejected</p>
                <p className="mt-0.5 text-base font-semibold">
                  {Number(financeSummary.rejectedCount || 0).toLocaleString()}
                </p>
              </PanelCard>
              <PanelCard className="p-3">
                <p className="text-xs text-(--muted)">Held</p>
                <p className="mt-0.5 text-base font-semibold">
                  {Number(financeSummary.heldCount || 0).toLocaleString()}
                </p>
              </PanelCard>
              <PanelCard className="p-3">
                <p className="text-xs text-(--muted)">Completed</p>
                <p className="mt-0.5 text-base font-semibold">
                  {Number(financeSummary.completedCount || 0).toLocaleString()}
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
                    {financeQuery.isLoading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-(--muted)">
                          Loading…
                        </td>
                      </tr>
                    ) : financeByDay.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-(--muted)">
                          No days in range.
                        </td>
                      </tr>
                    ) : (
                      financeByDay.map((row) => (
                        <tr
                          key={row.date}
                          className="border-b border-(--border) last:border-0"
                        >
                          <td className="px-4 py-2.5">{row.dayLabel}</td>
                          <td className="px-4 py-2.5 text-(--muted)">
                            {row.date}
                          </td>
                          <td className="px-4 py-2.5">
                            {money(row.depositsAmount)}
                            <span className="ml-1 text-xs text-(--muted)">
                              (
                              {Number(row.depositsCount || 0).toLocaleString()})
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {money(row.withdrawalsAmount)}
                            <span className="ml-1 text-xs text-(--muted)">
                              (
                              {Number(row.withdrawalsCount || 0).toLocaleString()}
                              )
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
          </>
        ) : (
          <>
            {salesQuery.isError ? (
              <PanelCard className="p-4">
                <p className="text-sm text-rose-600 dark:text-rose-400">
                  {errorMessage(salesQuery.error)}
                </p>
              </PanelCard>
            ) : null}

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PanelCard className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">
                  Total tickets
                </p>
                <p className="mt-2 text-xl font-semibold">
                  {number(salesSummary.totalTickets).toLocaleString()}
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">
                  Total stake
                </p>
                <p className="mt-2 text-xl font-semibold">
                  {number(salesSummary.totalStake).toLocaleString()} ETB
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">
                  Average stake
                </p>
                <p className="mt-2 text-xl font-semibold">
                  {number(salesSummary.averageStake).toLocaleString()} ETB
                </p>
              </PanelCard>
              <PanelCard className="p-4">
                <p className="text-xs uppercase tracking-wide text-(--muted)">
                  Open / Won / Lost
                </p>
                <p className="mt-2 text-xl font-semibold">
                  {number(salesSummary.openTickets)} /{" "}
                  {number(salesSummary.wonTickets)} /{" "}
                  {number(salesSummary.lostTickets)}
                </p>
              </PanelCard>
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <PanelCard className="overflow-x-auto">
                <div className="border-b border-(--border) px-4 py-3">
                  <h3 className="text-base font-semibold">By branch</h3>
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
                    {salesQuery.isLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                          Loading report…
                        </td>
                      </tr>
                    ) : salesByBranch.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                          No branch data in this filter.
                        </td>
                      </tr>
                    ) : (
                      salesByBranch.map((item) => (
                        <tr
                          key={item.branchName}
                          className="border-b border-(--border)/60"
                        >
                          <td className="px-4 py-3">{item.branchName}</td>
                          <td className="px-4 py-3">
                            {number(item.tickets).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            {number(item.stake).toLocaleString()} ETB
                          </td>
                          <td className="px-4 py-3">
                            {number(item.open).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </PanelCard>

              <PanelCard className="overflow-x-auto">
                <div className="border-b border-(--border) px-4 py-3">
                  <h3 className="text-base font-semibold">By cashier</h3>
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
                    {salesQuery.isLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                          Loading report…
                        </td>
                      </tr>
                    ) : salesByCashier.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-(--muted)" colSpan={4}>
                          No cashier data in this filter.
                        </td>
                      </tr>
                    ) : (
                      salesByCashier.map((item) => (
                        <tr
                          key={item.cashierProfileId}
                          className="border-b border-(--border)/60"
                        >
                          <td className="px-4 py-3">{item.cashierName}</td>
                          <td className="px-4 py-3">
                            {number(item.tickets).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            {number(item.stake).toLocaleString()} ETB
                          </td>
                          <td className="px-4 py-3">
                            {number(item.paid).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </PanelCard>
            </section>

            <PanelCard className="overflow-hidden p-0">
              <div className="border-b border-(--border) px-4 py-3">
                <h3 className="text-sm font-semibold">Daily breakdown</h3>
                <p className="mt-0.5 text-xs text-(--muted)">
                  Tickets and stake per day in the selected range.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-(--border) bg-(--surface-2) text-xs text-(--muted)">
                    <tr>
                      <th className="px-4 py-2 font-medium">Day</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Tickets</th>
                      <th className="px-4 py-2 font-medium">Stake</th>
                      <th className="px-4 py-2 font-medium">Open</th>
                      <th className="px-4 py-2 font-medium">Won</th>
                      <th className="px-4 py-2 font-medium">Lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesQuery.isLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-(--muted)">
                          Loading…
                        </td>
                      </tr>
                    ) : salesByDay.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-(--muted)">
                          No days in range.
                        </td>
                      </tr>
                    ) : (
                      salesByDay.map((row) => (
                        <tr
                          key={row.date}
                          className="border-b border-(--border) last:border-0"
                        >
                          <td className="px-4 py-2.5">{row.dayLabel}</td>
                          <td className="px-4 py-2.5 text-(--muted)">
                            {row.date}
                          </td>
                          <td className="px-4 py-2.5">
                            {number(row.tickets).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5">
                            {number(row.stake).toLocaleString()} ETB
                          </td>
                          <td className="px-4 py-2.5">
                            {number(row.open).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5">
                            {number(row.won).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5">
                            {number(row.lost).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </PanelCard>
          </>
        )}
      </div>
    </AdminShell>
  );
}
