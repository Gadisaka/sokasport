import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useAgentCashierWalletActivityQuery } from "../../hook/useAgentOperations";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function money(n) {
  return Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AgentDepositWithdrawPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [cashierId, setCashierId] = useState("");
  const [flow, setFlow] = useState("");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({
    from: today,
    to: today,
    cashierProfileId: "",
    flow: "",
  });

  const query = useAgentCashierWalletActivityQuery({
    from: applied.from,
    to: applied.to,
    cashierProfileId: applied.cashierProfileId,
    flow: applied.flow,
    page,
    limit: 20,
    enabled: true,
  });

  const items = query.data?.items ?? [];
  const cashierOptions = query.data?.cashiers ?? [];
  const totalPages = Number(query.data?.totalPages || 1);

  function onApply(event) {
    event.preventDefault();
    setPage(1);
    setApplied({
      from: fromDate,
      to: toDate,
      cashierProfileId: cashierId,
      flow,
    });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Deposit / Withdraw</h2>
          <p className="mt-1 text-sm text-(--muted)">
            <span className="font-medium text-(--text)">Deposit</span> — cash added{" "}
            <span className="font-medium text-(--text)">to a player&apos;s wallet</span> at the shop.{" "}
            <span className="font-medium text-(--text)">Withdraw</span> — cash paid out{" "}
            <span className="font-medium text-(--text)">from a player&apos;s wallet</span> (withdrawal
            collected by your cashier). Amounts match the player movement; balance after is the cashier
            shop wallet after the line posts.
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
              Cashier
              <select
                value={cashierId}
                onChange={(e) => setCashierId(e.target.value)}
                className="mt-1 block min-w-[10rem] rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              >
                <option value="">All cashiers</option>
                {cashierOptions.map((c) => (
                  <option key={c.cashierProfileId} value={c.cashierProfileId}>
                    {c.cashierName}
                    {c.branchName ? ` · ${c.branchName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-(--muted)">
              Flow
              <select
                value={flow}
                onChange={(e) => setFlow(e.target.value)}
                className="mt-1 block min-w-[12rem] rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              >
                <option value="">Deposits to players &amp; withdrawals from players</option>
                <option value="deposit">Deposit to player wallet only</option>
                <option value="withdraw">Withdraw from player wallet only</option>
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
              Failed to load activity.
            </div>
          ) : null}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Cashier</th>
                <th className="px-4 py-3 font-semibold">Branch</th>
                <th className="px-4 py-3 font-semibold">Player wallet</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">
                  Cashier wallet after
                </th>
                <th className="px-4 py-3 font-semibold">Reference</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    No player deposit or withdrawal activity in this range.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-(--border)/60">
                    <td className="px-4 py-3">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3">{row.cashierName || "—"}</td>
                    <td className="px-4 py-3">{row.branchName || "—"}</td>
                    <td className="px-4 py-3 font-medium">{row.playerFlowLabel || "—"}</td>
                    <td className="px-4 py-3">{money(row.amount)} ETB</td>
                    <td className="px-4 py-3">{money(row.balanceAfter)} ETB</td>
                    <td className="max-w-[14rem] truncate px-4 py-3 text-xs text-(--muted)" title={row.reference || ""}>
                      {row.reference || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-(--border) px-4 py-3 text-xs">
              <button
                type="button"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-(--muted)">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
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
