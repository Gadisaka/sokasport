import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { useVerifyPasswordMutation } from "../../hook/useVerifyPasswordMutation";
import { useCashierDashboardStatsQuery } from "../../hook/useCashierDashboardStats";
import { encodeSalesReportAsync } from "../../components/ticket/escpos";
import { print as printViaLocalService } from "../../services/localPrinter";

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function StatCard({ title, value, isCount }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-2 text-sm font-normal text-[var(--muted)]">
        {isCount ? (
          <>
            <span className="font-mono text-[var(--text)]"># </span>
            <span className="font-mono">{value}</span>
            <span className="ml-1">tickets</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-amber-500/90 ring-1 ring-amber-600/30" aria-hidden />
              <span className="font-mono">{value}</span>
              <span className="text-[var(--muted)]">ETB</span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const todayStr = useMemo(() => formatYmd(new Date()), []);
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [applied, setApplied] = useState({ from: todayStr, to: todayStr });
  const [printMessage, setPrintMessage] = useState("");
  const [printError, setPrintError] = useState("");
  const [printing, setPrinting] = useState(false);

  const query = useCashierDashboardStatsQuery({
    from: applied.from,
    to: applied.to,
    enabled: true,
  });

  const handleFilter = useCallback(
    (e) => {
      e.preventDefault();
      setApplied({ from, to });
    },
    [from, to],
  );

  const handlePrint = useCallback(async () => {
    const stats = query.data;
    if (!stats || printing) return;
    setPrinting(true);
    setPrintError("");
    setPrintMessage("");

    try {
      const escposData = await encodeSalesReportAsync(
        {
          cashierName: user?.name || "",
          fromLabel: applied.from,
          toLabel: applied.to,
          totalBets: stats.totalTicketsSold,
          totalBetsAmount: stats.totalSoldPrice,
          totalPaidCount: stats.totalPaidTickets,
          totalPayoutAmount: stats.totalPaidAmount,
          totalCancelledTickets: stats.totalCancelledTickets,
          totalCancelledStake: stats.totalCancelledStake,
          depositAmount: stats.totalDepositAmount,
          withdrawAmount: stats.totalWithdrawAmount,
          onHand: stats.grandNet,
        },
        { width: "80mm" },
      );

      const result = await printViaLocalService(escposData);
      if (result.success) {
        setPrintMessage("Sales report printed.");
        return;
      }

      if (result.code === "service_unreachable") {
        setPrintError(
          "Local print service unreachable. Start PrinterBridge.exe on this PC.",
        );
      } else if (result.code === "com_unavailable") {
        setPrintError(
          "Printer queue unavailable. Check POS80 is installed in Windows Print queues.",
        );
      } else {
        setPrintError(
          result.error?.message || "Failed to send report to local printer service.",
        );
      }
    } catch (err) {
      setPrintError(err?.message || "Failed to print sales report");
    } finally {
      setPrinting(false);
    }
  }, [applied.from, applied.to, printing, query.data, user?.name]);

  const fmtMoney = (n) =>
    Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCount = (n) =>
    Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const s = query.data;

  return (
    <div id="cashier-dashboard-print" className="space-y-4">
      <form
        onSubmit={handleFilter}
        className="no-print flex flex-wrap items-end gap-3 border-b border-[var(--border)] pb-4"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Filter
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={printing || !query.isSuccess}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {printing ? "Printing…" : "Print"}
        </button>
      </form>

      {printMessage && (
        <p className="no-print text-sm font-medium text-green-600 dark:text-green-400">
          {printMessage}
        </p>
      )}
      {printError && (
        <p className="no-print text-sm font-medium text-[var(--danger)]">
          {printError}
        </p>
      )}

      {query.isLoading && <p className="text-sm text-[var(--muted)]">Loading stats…</p>}
      {query.isError && (
        <p className="text-sm font-medium text-[var(--danger)]">
          {query.error?.message || "Could not load dashboard"}
        </p>
      )}

      {query.isSuccess && s && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Winning tickets (today / yesterday)
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard title="Won tickets (today)" value={fmtCount(s.wonToday?.tickets)} isCount />
            <StatCard title="Payable today" value={fmtMoney(s.wonToday?.payable)} />
            <StatCard title="Won tickets (yesterday)" value={fmtCount(s.wonYesterday?.tickets)} isCount />
            <StatCard title="Payable yesterday" value={fmtMoney(s.wonYesterday?.payable)} />
          </div>
        </div>
      )}

      {query.isSuccess && s && (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard title="Total tickets sold" value={fmtCount(s.totalTicketsSold)} isCount />
          <StatCard title="Sold tickets price" value={fmtMoney(s.totalSoldPrice)} />
          <StatCard title="Total Deposit Amount" value={fmtMoney(s.totalDepositAmount)} />
          <StatCard title="Total Withdraw Amount" value={fmtMoney(s.totalWithdrawAmount)} />
          <StatCard title="Total paid tickets" value={fmtCount(s.totalPaidTickets)} isCount />
          <StatCard title="Total paid amount" value={fmtMoney(s.totalPaidAmount)} />
          <StatCard title="Cancelled tickets" value={fmtCount(s.totalCancelledTickets)} isCount />
          <StatCard title="Cancelled stake" value={fmtMoney(s.totalCancelledStake)} />
          <div className="sm:col-span-2">
            <StatCard title="Grand Net" value={fmtMoney(s.grandNet)} />
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export default function CashierDashboardPage() {
  const { user, logout, loading } = useAuth();
  const verifyPassword = useVerifyPasswordMutation();
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await verifyPassword.mutateAsync({ password });
      setPassword("");
      setUnlocked(true);
    } catch (err) {
      setError(err?.message || "Invalid password");
    }
  };

  return (
    <AdminShell user={user} onLogout={logout}>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading...</p>
      ) : !unlocked ? (
        <div className="flex h-full items-center justify-center pt-8">
          <PanelCard className="w-full max-w-sm p-6 pt-8">
            <h2 className="mb-2 text-xl font-semibold">Unlock Dashboard</h2>
            <p className="mb-6 text-sm text-[var(--muted)]">
              Enter your cashier account password to open this dashboard.
            </p>
            <form onSubmit={handleUnlock} className="flex flex-col gap-4">
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-50)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
                  required
                />
              </div>
              {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
              <button
                type="submit"
                disabled={verifyPassword.isPending}
                className="mt-2 w-full rounded-md bg-[var(--accent)] py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {verifyPassword.isPending ? "Unlocking..." : "Unlock"}
              </button>
            </form>
          </PanelCard>
        </div>
      ) : (
        <PanelCard className="p-6">
          <h2 className="text-2xl font-semibold">Cashier Dashboard</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sales, payouts, and player wallet movements for your branch (non-jackpot tickets only).
          </p>
          <div className="mt-6">
            <DashboardContent />
          </div>
        </PanelCard>
      )}
    </AdminShell>
  );
}
