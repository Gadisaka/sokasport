import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import {
  useCashierDepositMutation,
  useCashierHistoryQuery,
  useCashierShopWithdrawPreviewMutation,
  useCashierShopWithdrawRedeemMutation,
} from "../../hook/useCashierWallet";
import Modal from "../../components/ui/Modal";

// ─── Main page ──────────────────────────────────────────────────────────────

export default function WithdrawDepositPage() {
  const { user, logout } = useAuth();

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Withdraw / Deposit</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Deposit into player accounts or complete in-shop withdrawals with a 6-digit code.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left — deposit & withdraw */}
        <div className="space-y-6">
          <DepositSection />
          <WithdrawSection />
        </div>

        {/* Right — history */}
        <HistorySection />
      </div>
    </AdminShell>
  );
}

// ─── Deposit ────────────────────────────────────────────────────────────────

function DepositSection() {
  const deposit = useCashierDepositMutation();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState("");

  const handleDeposit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(null);

    try {
      const result = await deposit.mutateAsync({
        phone: phone.trim(),
        amount: Number(amount),
      });
      setSuccess(result);
      setPhone("");
      setAmount("");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err?.message || "Deposit failed");
    }
  };

  return (
    <PanelCard className="p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide">Deposit</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Fill a player's wallet from your cashier balance.
      </p>

      <form onSubmit={handleDeposit} className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Player Phone
          </span>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0912345678"
            required
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Amount
          </span>
          <input
            type="number"
            min="1"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            required
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <PrimaryButton type="submit" disabled={deposit.isPending} className="w-full">
          {deposit.isPending ? "Processing..." : "Deposit"}
        </PrimaryButton>
      </form>

      {success && (
        <div className="mt-3 rounded-sm border border-green-500/30 bg-green-500/10 p-3 text-xs">
          <p className="font-semibold text-green-600">Deposit successful!</p>
          <p className="mt-1 text-[var(--text)]">
            {success.playerName} — New balance:{" "}
            <span className="font-mono">{Number(success.playerBalance).toLocaleString()}</span>
          </p>
          <p className="text-[var(--muted)]">
            Cashier balance:{" "}
            <span className="font-mono">{Number(success.cashierBalance).toLocaleString()}</span>
          </p>
        </div>
      )}
      {error && <p className="mt-3 text-xs font-medium text-[var(--danger)]">{error}</p>}
    </PanelCard>
  );
}

// ─── Withdraw ───────────────────────────────────────────────────────────────

function WithdrawSection() {
  const preview = useCashierShopWithdrawPreviewMutation();
  const redeem = useCashierShopWithdrawRedeemMutation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSnapshot, setConfirmSnapshot] = useState(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successPayload, setSuccessPayload] = useState(null);

  const digitsOnlyCode = code.replace(/\D/g, "").slice(0, 6);

  async function handleWithdraw(e) {
    e.preventDefault();
    setError("");
    setConfirmSnapshot(null);

    if (!phone.trim()) {
      setError("Player phone is required");
      return;
    }
    if (!/^\d{6}$/.test(digitsOnlyCode)) {
      setError("Enter the 6-digit withdrawal code");
      return;
    }

    try {
      const data = await preview.mutateAsync({
        phone: phone.trim(),
        code: digitsOnlyCode,
      });
      setConfirmSnapshot(data);
      setConfirmOpen(true);
    } catch (err) {
      setError(err?.message || "Could not look up this withdrawal");
    }
  }

  async function handleConfirmRedeem() {
    if (!confirmSnapshot) return;
    setError("");
    try {
      const result = await redeem.mutateAsync({
        phone: confirmSnapshot.phone,
        code: digitsOnlyCode,
        amount: confirmSnapshot.amount,
      });
      setConfirmOpen(false);
      setConfirmSnapshot(null);
      setSuccessPayload(result);
      setSuccessOpen(true);
      setPhone("");
      setCode("");
    } catch (err) {
      setConfirmOpen(false);
      setConfirmSnapshot(null);
      setError(err?.message || "Withdraw failed");
    }
  }

  return (
    <PanelCard className="p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide">Withdraw</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Enter the player&apos;s phone and the 6-digit code from their app. The payout amount is loaded automatically.
      </p>

      <form onSubmit={handleWithdraw} className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Player Phone
          </span>
          <input
            type="text"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setError("");
            }}
            placeholder="e.g. 0912345678"
            required
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            One-time code
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            placeholder="000000"
            required
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-sm tracking-widest text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <button
          type="submit"
          disabled={preview.isPending}
          className="w-full rounded-sm border border-transparent bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
        >
          {preview.isPending ? "Looking up..." : "Withdraw"}
        </button>
      </form>

      {error && <p className="mt-3 text-xs font-medium text-[var(--danger)]">{error}</p>}

      <Modal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setConfirmSnapshot(null);
        }}
        title="Confirm withdrawal"
      >
        {confirmSnapshot && (
          <>
            <p className="text-sm text-[var(--text)]">
              Pay out{" "}
              <span className="font-mono font-bold">
                {Number(confirmSnapshot.amount).toLocaleString()} ETB
              </span>{" "}
              to{" "}
              <span className="font-semibold">{confirmSnapshot.playerName}</span>{" "}
              <span className="text-[var(--muted)]">({confirmSnapshot.phone})</span>
              ?
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              The player&apos;s wallet will be debited and your cashier balance will be credited.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmSnapshot(null);
                }}
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRedeem}
                disabled={redeem.isPending}
                className="rounded-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {redeem.isPending ? "Processing..." : "Confirm"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={successOpen}
        onClose={() => {
          setSuccessOpen(false);
          setSuccessPayload(null);
        }}
        title="Withdrawal complete"
      >
        {successPayload && (
          <div className="space-y-3 text-sm text-[var(--text)]">
            <p className="font-semibold text-green-600">Success</p>
            {successPayload.playerName ? (
              <p>
                Player: <span className="font-medium">{successPayload.playerName}</span>
              </p>
            ) : null}
            <p>
              Your cashier balance:{" "}
              <span className="font-mono font-bold">
                {Number(successPayload.cashierBalance ?? 0).toLocaleString()} ETB
              </span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              You can close this dialog or process another withdrawal.
            </p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setSuccessOpen(false);
                  setSuccessPayload(null);
                }}
                className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </PanelCard>
  );
}

// ─── History (right side) ───────────────────────────────────────────────────

function HistorySection() {
  const [activeTab, setActiveTab] = useState("DEPOSIT");
  const [page, setPage] = useState(1);
  const query = useCashierHistoryQuery({ type: activeTab, page });
  const { items = [], totalPages = 1, balance } = query.data ?? {};

  return (
    <PanelCard className="p-0">
      {/* Balance header */}
      {balance != null && (
        <div className="border-b border-[var(--border)] px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Your Cashier Balance
          </p>
          <p className="mt-0.5 text-lg font-bold font-mono">
            {Number(balance).toLocaleString()} <span className="text-sm font-normal text-[var(--muted)]">ETB</span>
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {[
          { key: "DEPOSIT", label: "Deposits" },
          { key: "WITHDRAW", label: "Withdrawals" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setPage(1);
            }}
            className={`flex-1 border-b-2 px-4 py-2.5 text-center text-sm font-semibold ${
              activeTab === tab.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-[var(--muted)]">
                  No transactions found.
                </td>
              </tr>
            ) : (
              items.map((tx) => (
                <tr key={tx.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 text-xs">{new Date(tx.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono">
                    {activeTab === "DEPOSIT" ? "-" : "+"}
                    {Number(tx.amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {Number(tx.balanceBefore).toLocaleString()}
                    </span>
                    <span className="mx-1 text-[var(--muted)]">→</span>
                    <span className="font-mono text-xs">
                      {Number(tx.balanceAfter).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] max-w-[140px] truncate">
                    {tx.reference || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-[var(--border)] px-4 py-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </PanelCard>
  );
}
