import { useDeferredValue, useState } from "react";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import TextInput from "../components/ui/TextInput";
import SelectInput from "../components/ui/SelectInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import {
  useApproveRequestMutation,
  useDeductWalletMutation,
  useFillWalletMutation,
  useGlobalWalletHistoryQuery,
  useHoldRequestMutation,
  usePendingRequestsQuery,
  useRejectRequestMutation,
  useWalletDirectoryQuery,
} from "../hook/useWallets";

const TABS = [
  { key: "pending", label: "Pending Requests" },
  { key: "manage", label: "Manage Wallets" },
  { key: "history", label: "Transaction History" },
];

export default function WalletsPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("pending");
  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Wallets</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage cashier/player wallets, process requests, and review transaction history.
        </p>
      </div>
      <div className="mb-5 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${
              activeTab === tab.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "pending" && <PendingRequestsTab />}
      {activeTab === "manage" && <ManageWalletsTab />}
      {activeTab === "history" && <WalletHistoryTab />}
    </AdminShell>
  );
}

function PendingRequestsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("PENDING");
  const [type, setType] = useState("");
  const query = usePendingRequestsQuery({ page, status, type });
  const approve = useApproveRequestMutation();
  const reject = useRejectRequestMutation();
  const hold = useHoldRequestMutation();
  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <>
      <PanelCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <SelectInput
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "PENDING", label: "Pending" },
              { value: "HELD", label: "Held" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
            ]}
          />
          <SelectInput
            label="Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "DEPOSIT", label: "Deposit" },
              { value: "WITHDRAW", label: "Withdraw" },
            ]}
            placeholder="All types"
          />
        </div>
      </PanelCard>
      <PanelCard className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{r.user?.fullname || "—"}</p>
                  <p className="text-xs text-[var(--muted)]">{r.user?.phone || r.user?.email || "—"}</p>
                </td>
                <td className="px-4 py-3">{r.type}</td>
                <td className="px-4 py-3 font-mono">{Number(r.amount).toLocaleString()}</td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => approve.mutate(r.id)} className="text-xs font-semibold text-green-600">
                      Approve
                    </button>
                    <button type="button" onClick={() => reject.mutate(r.id)} className="text-xs font-semibold text-[var(--danger)]">
                      Reject
                    </button>
                    <button type="button" onClick={() => hold.mutate(r.id)} className="text-xs font-semibold text-[var(--accent)]">
                      Hold
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelCard>
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </>
  );
}

function ManageWalletsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [walletType, setWalletType] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = useWalletDirectoryQuery({ page, search: deferredSearch, walletType });
  const fill = useFillWalletMutation();
  const deduct = useDeductWalletMutation();
  const { items = [], totalPages = 1 } = query.data ?? {};

  const selectedWallet = items.find((w) => w.id === selectedWalletId) || null;

  function perform(action) {
    const numericAmount = Number(amount);
    if (!selectedWalletId || !Number.isFinite(numericAmount) || numericAmount <= 0) return;
    if (action === "fill") {
      fill.mutate({ walletId: selectedWalletId, amount: numericAmount, reference });
    } else {
      deduct.mutate({ walletId: selectedWalletId, amount: numericAmount, reference });
    }
    setAmount("");
    setReference("");
  }

  return (
    <>
      <PanelCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <TextInput label="Search user" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, phone, or email" />
          <SelectInput
            label="Wallet type"
            value={walletType}
            onChange={(e) => { setWalletType(e.target.value); setPage(1); }}
            placeholder="All wallets"
            options={[
              { value: "CASHIER", label: "Cashier" },
              { value: "PLAYER", label: "Player" },
            ]}
          />
          <SelectInput
            label="Selected wallet"
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            placeholder="Choose wallet..."
            options={items.map((w) => ({
              value: w.id,
              label: `${w.user.fullname} (${w.walletType})`,
            }))}
          />
        </div>
        {selectedWallet && (
          <div className="mt-4 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-3 text-sm">
            <p className="font-medium">{selectedWallet.user.fullname}</p>
            <p className="text-xs text-[var(--muted)]">{selectedWallet.user.phone || selectedWallet.user.email}</p>
            <p className="mt-1 font-mono">Balance: {Number(selectedWallet.balance).toLocaleString()}</p>
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <TextInput label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          <TextInput label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional note" />
          <div className="flex items-end gap-2">
            <PrimaryButton className="w-1/2" onClick={() => perform("fill")}>Fill</PrimaryButton>
            <button type="button" onClick={() => perform("deduct")} className="w-1/2 rounded-sm border border-[var(--danger)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)]">Deduct</button>
          </div>
        </div>
      </PanelCard>

      <PanelCard className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Wallet Type</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Branch</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} onClick={() => setSelectedWalletId(w.id)} className="cursor-pointer border-b border-[var(--border)] hover:bg-[var(--surfaceMuted)] last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{w.user.fullname}</p>
                  <p className="text-xs text-[var(--muted)]">{w.user.phone || w.user.email || "—"}</p>
                </td>
                <td className="px-4 py-3">{w.user.role}</td>
                <td className="px-4 py-3">{w.walletType}</td>
                <td className="px-4 py-3 font-mono">{Number(w.balance).toLocaleString()}</td>
                <td className="px-4 py-3">{w.user.branch ? `${w.user.branch.name} — ${w.user.branch.location}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelCard>
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </>
  );
}

function WalletHistoryTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [walletType, setWalletType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = useGlobalWalletHistoryQuery({ page, search: deferredSearch, type, walletType, from, to });
  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <>
      <PanelCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <TextInput label="Search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Reference, user..." />
          <SelectInput label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="All types" options={[{ value: "DEPOSIT", label: "Deposit" }, { value: "WITHDRAW", label: "Withdraw" }, { value: "PAYOUT", label: "Payout" }, { value: "CASHOUT", label: "Cashout" }]} />
          <SelectInput label="Wallet type" value={walletType} onChange={(e) => { setWalletType(e.target.value); setPage(1); }} placeholder="All wallets" options={[{ value: "CASHIER", label: "Cashier" }, { value: "PLAYER", label: "Player" }]} />
          <TextInput label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <TextInput label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </PanelCard>
      <PanelCard className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Before</th>
              <th className="px-4 py-3">After</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tx) => (
              <tr key={tx.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 text-xs">{new Date(tx.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{tx.user?.fullname || "—"}</p>
                  <p className="text-xs text-[var(--muted)]">{tx.user?.phone || tx.user?.email || "—"}</p>
                </td>
                <td className="px-4 py-3">{tx.type}</td>
                <td className="px-4 py-3 font-mono">{Number(tx.amount).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono">{Number(tx.balanceBefore).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono">{Number(tx.balanceAfter).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs">{tx.reference || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelCard>
      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </>
  );
}

function Pagination({ page, totalPages, setPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
        Previous
      </button>
      <span className="text-[var(--muted)]">Page {page} of {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
        Next
      </button>
    </div>
  );
}
