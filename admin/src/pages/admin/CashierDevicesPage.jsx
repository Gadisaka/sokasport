import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import SelectInput from "../../components/ui/SelectInput";
import PrimaryButton from "../../components/ui/PrimaryButton";
import {
  useApproveDeviceMutation,
  usePendingDeviceApprovalsQuery,
  useRejectDeviceMutation,
  useRevokeDeviceMutation,
  useTrustedDevicesQuery,
} from "../../hook/useCashierDevices";

const TABS = [
  { key: "pending", label: "Pending Approvals" },
  { key: "trusted", label: "Trusted Devices" },
];

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function CashierDevicesPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("pending");

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Cashier Devices</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Review new cashier device login requests and manage trusted devices.
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

      {activeTab === "pending" ? <PendingApprovalsTab /> : <TrustedDevicesTab />}
    </AdminShell>
  );
}

function PendingApprovalsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("PENDING");
  const query = usePendingDeviceApprovalsQuery({ page, status });
  const approve = useApproveDeviceMutation();
  const reject = useRejectDeviceMutation();
  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <>
      <PanelCard className="mb-4 p-4">
        <SelectInput
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "PENDING", label: "Pending" },
            { value: "APPROVED", label: "Approved" },
            { value: "REJECTED", label: "Rejected" },
          ]}
        />
      </PanelCard>

      <PanelCard className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--surfaceMuted)]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Cashier</th>
              <th className="px-4 py-3 text-left font-semibold">Phone</th>
              <th className="px-4 py-3 text-left font-semibold">IP</th>
              <th className="px-4 py-3 text-left font-semibold">User Agent</th>
              <th className="px-4 py-3 text-left font-semibold">Requested</th>
              <th className="px-4 py-3 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                  Loading...
                </td>
              </tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                  No device requests found.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">{item.cashier?.name || "—"}</td>
                <td className="px-4 py-3">{item.cashier?.phone || "—"}</td>
                <td className="px-4 py-3">{item.ipAddress || "—"}</td>
                <td className="max-w-xs truncate px-4 py-3" title={item.userAgent || ""}>
                  {item.userAgent || "—"}
                </td>
                <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
                <td className="px-4 py-3">
                  {item.status === "PENDING" ? (
                    <div className="flex gap-2">
                      <PrimaryButton
                        type="button"
                        disabled={approve.isPending || reject.isPending}
                        onClick={() => approve.mutate(item.id)}
                      >
                        Approve
                      </PrimaryButton>
                      <button
                        type="button"
                        disabled={approve.isPending || reject.isPending}
                        onClick={() => reject.mutate(item.id)}
                        className="rounded-sm border border-[color:var(--dangerSoft)] px-3 py-2 text-xs font-semibold text-[var(--danger)]"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[var(--muted)]">{item.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelCard>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-sm text-[var(--accent)] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-[var(--accent)] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

function TrustedDevicesTab() {
  const [page, setPage] = useState(1);
  const query = useTrustedDevicesQuery({ page, activeOnly: true });
  const revoke = useRevokeDeviceMutation();
  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <>
      <PanelCard className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--surfaceMuted)]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Cashier</th>
              <th className="px-4 py-3 text-left font-semibold">Phone</th>
              <th className="px-4 py-3 text-left font-semibold">First IP</th>
              <th className="px-4 py-3 text-left font-semibold">Latest IP</th>
              <th className="px-4 py-3 text-left font-semibold">Last Seen</th>
              <th className="px-4 py-3 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                  Loading...
                </td>
              </tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                  No active trusted devices.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">{item.cashier?.name || "—"}</td>
                <td className="px-4 py-3">{item.cashier?.phone || "—"}</td>
                <td className="px-4 py-3">{item.firstIp || "—"}</td>
                <td className="px-4 py-3">{item.latestIp || "—"}</td>
                <td className="px-4 py-3">{formatDate(item.lastSeenAt)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(item.id)}
                    className="rounded-sm border border-[color:var(--dangerSoft)] px-3 py-2 text-xs font-semibold text-[var(--danger)]"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelCard>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-sm text-[var(--accent)] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-[var(--accent)] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
