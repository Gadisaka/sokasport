import { useState, useDeferredValue } from "react";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import Tag from "../components/ui/Tag";
import TextInput from "../components/ui/TextInput";
import SelectInput from "../components/ui/SelectInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import Modal from "../components/ui/Modal";
import CashierForm from "../components/agents-cashiers/CashierForm";
import AgentForm from "../components/agents-cashiers/AgentForm";
import {
  useCashiersQuery,
  useCreateCashierMutation,
  useUpdateCashierMutation,
  useDeleteCashierMutation,
  useAgentsQuery,
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useDeleteAgentMutation,
  useAssignableCashiersQuery,
  useAssignAgentMutation,
  useUnassignAgentMutation,
} from "../hook/useAgentsCashiers";

const TABS = [
  { key: "cashiers", label: "Cashiers" },
  { key: "agents", label: "Agents" },
];

export default function AgentsCashiersPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("cashiers");

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Agents & Cashiers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Create cashiers with branches, manage agents, and assign agents to
          branches.
        </p>
      </div>

      <div className="mb-5 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "cashiers" && <CashiersTab />}
      {activeTab === "agents" && <AgentsTab />}
    </AdminShell>
  );
}

// ─── Cashiers tab ────────────────────────────────────────────────────────────

function CashiersTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [modalMode, setModalMode] = useState(null); // "create" | "detail"
  const [selectedCashier, setSelectedCashier] = useState(null);

  const query = useCashiersQuery({ page, search: deferredSearch });
  const createMutation = useCreateCashierMutation();

  function closeModal() {
    setModalMode(null);
    setSelectedCashier(null);
  }

  async function handleCreate(body) {
    await createMutation.mutateAsync(body);
    closeModal();
  }

  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <TextInput
            label="Search cashiers"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name, phone, or email"
          />
        </div>
        <PrimaryButton
          onClick={() => {
            setSelectedCashier(null);
            setModalMode("create");
          }}
          className="w-auto"
        >
          + New cashier
        </PrimaryButton>
      </div>

      <PanelCard className="overflow-x-auto">
        {query.isLoading ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">
            Loading...
          </p>
        ) : query.isError ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--danger)]">
            {query.error?.message || "Failed to load"}
          </p>
        ) : items.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">
            No cashiers found.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Branch</th>
                <th className="px-4 py-3 font-semibold">Wallet</th>
                <th className="px-4 py-3 font-semibold">Agent</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => {
                    setSelectedCashier(c);
                    setModalMode("detail");
                  }}
                  className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--surfaceMuted)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.fullname}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {c.phone || c.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {c.branch ? (
                      <>
                        <p className="font-medium">{c.branch.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {c.branch.location}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">
                    {c.wallet ? c.wallet.balance.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {c.agent ? (
                      <Tag>{c.agent.fullname}</Tag>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot active={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelCard>

      <Pagination page={page} totalPages={totalPages} setPage={setPage} />

      {/* Create modal */}
      <Modal
        open={modalMode === "create"}
        onClose={closeModal}
        title="New cashier"
      >
        <CashierForm
          onSubmit={handleCreate}
          isPending={createMutation.isPending}
        />
      </Modal>

      {/* Detail modal (edit, delete, assign agent) */}
      {modalMode === "detail" && selectedCashier && (
        <CashierDetail cashier={selectedCashier} onClose={closeModal} />
      )}
    </>
  );
}

// ─── Cashier detail (edit + delete + agent assign) ───────────────────────────

function CashierDetail({ cashier, onClose }) {
  const { user } = useAuth();
  const [showEdit, setShowEdit] = useState(false);
  const agentsQuery = useAgentsQuery({ page: 1 });
  const updateMutation = useUpdateCashierMutation();
  const deleteMutation = useDeleteCashierMutation();
  const assignMutation = useAssignAgentMutation();
  const unassignMutation = useUnassignAgentMutation();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [feedback, setFeedback] = useState("");
  const canTopUpWallet =
    user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const agentOptions = (agentsQuery.data?.items ?? []).map((a) => ({
    value: a.id,
    label: a.fullname,
  }));

  async function handleUpdate(body) {
    await updateMutation.mutateAsync({ id: cashier.id, ...body });
    setShowEdit(false);
    onClose();
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete cashier "${cashier.fullname}" and their profile? This cannot be undone.`,
      )
    )
      return;
    await deleteMutation.mutateAsync(cashier.id);
    onClose();
  }

  async function handleAssign() {
    if (!selectedAgentId || !cashier.cashierProfileId) return;
    setFeedback("");
    try {
      await assignMutation.mutateAsync({
        agentId: selectedAgentId,
        cashierProfileId: cashier.cashierProfileId,
      });
      setFeedback("Agent assigned.");
    } catch (err) {
      setFeedback(err.message || "Failed");
    }
  }

  async function handleUnassign() {
    if (!cashier.cashierProfileId) return;
    setFeedback("");
    try {
      await unassignMutation.mutateAsync(cashier.cashierProfileId);
      setFeedback("Agent removed.");
    } catch (err) {
      setFeedback(err.message || "Failed");
    }
  }

  async function handleTopUp() {
    if (!canTopUpWallet || updateMutation.isPending) return;

    const rawAmount = window.prompt("Enter top up amount");
    if (rawAmount === null) return;

    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("Please enter a valid amount greater than zero.");
      return;
    }

    const currentBalance = Number(cashier.wallet?.balance ?? 0);
    const nextBalance = currentBalance + amount;
    await updateMutation.mutateAsync({ id: cashier.id, wallet: nextBalance });
    onClose();
  }

  if (showEdit) {
    return (
      <Modal open onClose={() => setShowEdit(false)} title="Edit cashier">
        <CashierForm
          key={cashier.id}
          initialValues={cashier}
          onSubmit={handleUpdate}
          isPending={updateMutation.isPending}
        />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Cashier details">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailRow label="Name" value={cashier.fullname} />
          <DetailRow label="Username" value={cashier.username || "—"} />
          <DetailRow label="Email" value={cashier.email} />
          <DetailRow label="Phone" value={cashier.phone || "—"} />
          <DetailRow
            label="Status"
            value={cashier.status ? "Active" : "Disabled"}
          />
          <DetailRow
            label="Branch"
            value={
              cashier.branch
                ? `${cashier.branch.name} — ${cashier.branch.location}`
                : "—"
            }
          />
          <DetailRow
            label="Wallet"
            value={
              <div className="flex items-center gap-2">
                <span>
                  {cashier.wallet ? cashier.wallet.balance.toLocaleString() : "—"}
                </span>
                {canTopUpWallet && (
                  <button
                    type="button"
                    onClick={handleTopUp}
                    disabled={updateMutation.isPending}
                    className="rounded-sm border border-[var(--accent)] px-2 py-1 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                  >
                    {updateMutation.isPending ? "..." : "Top Up"}
                  </button>
                )}
              </div>
            }
          />
        </div>

        {/* Agent assignment */}
        <div className="border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assigned agent
          </p>
          {cashier.agent ? (
            <div className="flex items-center justify-between">
              <Tag>{cashier.agent.fullname}</Tag>
              <button
                type="button"
                onClick={handleUnassign}
                disabled={unassignMutation.isPending}
                className="text-xs font-semibold text-[var(--danger)]"
              >
                {unassignMutation.isPending ? "Removing..." : "Remove"}
              </button>
            </div>
          ) : (
            <p className="mb-2 text-sm text-[var(--muted)]">
              No agent assigned.
            </p>
          )}
          <div className="mt-3 flex items-end w-full gap-2">
            <div className="flex w-1/2 ">
              <SelectInput
                label={cashier.agent ? "Reassign to" : "Assign agent"}
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                options={agentOptions}
                placeholder="Select agent..."
                className="w-full"
              />
            </div>
            <PrimaryButton
              onClick={handleAssign}
              disabled={!selectedAgentId || assignMutation.isPending}
              className="w-1/2"
            >
              {assignMutation.isPending ? "..." : "Assign"}
            </PrimaryButton>
          </div>
          {feedback && (
            <p className="mt-2 text-xs font-medium text-[var(--accent)]">
              {feedback}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-[var(--border)] pt-4">
          <PrimaryButton onClick={() => setShowEdit(true)} className="w-auto">
            Edit
          </PrimaryButton>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="rounded-sm border border-[var(--danger)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)] disabled:opacity-60"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

// ─── Agents tab (card view) ──────────────────────────────────────────────────

function AgentsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showCreate, setShowCreate] = useState(false);

  const query = useAgentsQuery({ page, search: deferredSearch });
  const cashiersQuery = useAssignableCashiersQuery();
  const createMutation = useCreateAgentMutation();
  const updateMutation = useUpdateAgentMutation();
  const deleteMutation = useDeleteAgentMutation();
  const assignMutation = useAssignAgentMutation();
  const unassignMutation = useUnassignAgentMutation();

  const { items = [], totalPages = 1 } = query.data ?? {};

  function getAvailableCashiers(agentId) {
    return (cashiersQuery.data ?? []).filter(
      (c) => !c.agent || c.agent.id === agentId,
    );
  }

  async function handleCreate(body) {
    await createMutation.mutateAsync(body);
    setShowCreate(false);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <TextInput
            label="Search agents"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name, phone, or email"
          />
        </div>
        <PrimaryButton onClick={() => setShowCreate(true)} className="w-auto">
          + New agent
        </PrimaryButton>
      </div>

      {query.isLoading ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">
          Loading...
        </p>
      ) : query.isError ? (
        <p className="py-12 text-center text-sm text-[var(--danger)]">
          {query.error?.message || "Failed to load"}
        </p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">
          No agents found.
        </p>
      ) : (
        <div className="space-y-4">
          {items.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              availableCashiers={getAvailableCashiers(agent.id)}
              onAssign={(cashierProfileId) =>
                assignMutation.mutateAsync({
                  agentId: agent.id,
                  cashierProfileId,
                })
              }
              onUnassign={(cashierProfileId) =>
                unassignMutation.mutateAsync(cashierProfileId)
              }
              onUpdate={(body) =>
                updateMutation.mutateAsync({ id: agent.id, ...body })
              }
              onDelete={() => deleteMutation.mutateAsync(agent.id)}
              isAssigning={assignMutation.isPending}
              isUnassigning={unassignMutation.isPending}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} setPage={setPage} />

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New agent"
      >
        <AgentForm
          onSubmit={handleCreate}
          isPending={createMutation.isPending}
        />
      </Modal>
    </>
  );
}

function AgentCard({
  agent,
  availableCashiers,
  onAssign,
  onUnassign,
  onUpdate,
  onDelete,
  isAssigning,
  isUnassigning,
}) {
  const [selectedCashierId, setSelectedCashierId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  const cashierOptions = availableCashiers
    .filter(
      (c) =>
        !agent.cashiers.some(
          (ac) => ac.cashierProfileId === c.cashierProfileId,
        ),
    )
    .map((c) => ({
      value: c.cashierProfileId,
      label: `${c.fullname} — ${c.branchName} (${c.branchLocation})`,
    }));

  async function handleAssign() {
    if (!selectedCashierId) return;
    setFeedback("");
    try {
      await onAssign(selectedCashierId);
      setSelectedCashierId("");
      setFeedback("Cashier assigned.");
      setTimeout(() => setFeedback(""), 2000);
    } catch (err) {
      setFeedback(err.message || "Failed");
    }
  }

  async function handleUnassign(cashierProfileId) {
    setFeedback("");
    try {
      await onUnassign(cashierProfileId);
      setFeedback("Cashier removed.");
      setTimeout(() => setFeedback(""), 2000);
    } catch (err) {
      setFeedback(err.message || "Failed");
    }
  }

  async function handleUpdate(body) {
    await onUpdate(body);
    setShowEdit(false);
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete agent "${agent.fullname}"? All cashier assignments will be removed.`,
      )
    )
      return;
    await onDelete();
  }

  return (
    <>
      <PanelCard className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-base font-semibold">{agent.fullname}</p>
            <p className="text-xs text-[var(--muted)]">
              {agent.phone || agent.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot active={agent.status} />
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-sm border border-[var(--danger)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)]"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Assigned cashiers */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assigned cashiers ({agent.cashiers.length})
          </p>
          {agent.cashiers.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No cashiers assigned yet.
            </p>
          ) : (
            <div className="space-y-2">
              {agent.cashiers.map((ac) => (
                <div
                  key={ac.cashierProfileId}
                  className="flex items-start justify-between rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{ac.fullname}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {ac.branchName} — {ac.branchLocation}
                    </p>
                    <p className="mt-1 text-xs font-mono text-[var(--muted)]">
                      Wallet: {ac.walletBalance.toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnassign(ac.cashierProfileId)}
                    disabled={isUnassigning}
                    className="shrink-0 text-xs font-semibold text-[var(--danger)]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign new cashier */}
        {cashierOptions.length > 0 && (
          <div className="mt-4 flex items-end gap-2 border-t border-[var(--border)] pt-4">
            <div className="flex-1">
              <SelectInput
                label="Add cashier"
                value={selectedCashierId}
                onChange={(e) => setSelectedCashierId(e.target.value)}
                options={cashierOptions}
                placeholder="Select cashier..."
              />
            </div>
            <PrimaryButton
              onClick={handleAssign}
              disabled={!selectedCashierId || isAssigning}
              className="w-auto"
            >
              {isAssigning ? "..." : "Assign"}
            </PrimaryButton>
          </div>
        )}

        {feedback && (
          <p className="mt-2 text-xs font-medium text-[var(--accent)]">
            {feedback}
          </p>
        )}
      </PanelCard>

      {/* Edit modal */}
      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit agent"
      >
        <AgentForm
          key={agent.id}
          initialValues={agent}
          onSubmit={handleUpdate}
          isPending={false}
        />
      </Modal>
    </>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function StatusDot({ active }) {
  return (
    <>
      <span
        className={`inline-block h-2 w-2 rounded-full ${active ? "bg-green-500" : "bg-[var(--danger)]"}`}
      />{" "}
      <span className="text-xs text-[var(--muted)]">
        {active ? "Active" : "Disabled"}
      </span>
    </>
  );
}

function Pagination({ page, totalPages, setPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => setPage((p) => p - 1)}
        className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-[var(--muted)]">
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
  );
}
