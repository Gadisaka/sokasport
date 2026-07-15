import { useState, useDeferredValue } from "react";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import Tag from "../components/ui/Tag";
import TextInput from "../components/ui/TextInput";
import SelectInput from "../components/ui/SelectInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import Modal from "../components/ui/Modal";
import UserForm from "../components/users/UserForm";
import { useUsersQuery, useUsersMetaQuery } from "../hook/useUsersQuery";
import {
  useCreateUserMutation,
  useDeleteUserMutation,
  useUpdateUserMutation,
} from "../hook/useUserMutations";
import { ROLE_LABELS } from "../constants/auth";

export default function UsersPage() {
  const { user, logout } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [activeTab, setActiveTab] = useState("staff"); // "staff" | "players"
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const effectiveRoleFilter = activeTab === "players" ? "PLAYER" : roleFilter;

  const usersQuery = useUsersQuery({
    page,
    search: deferredSearch,
    role: effectiveRoleFilter,
    status: statusFilter,
  });
  const metaQuery = useUsersMetaQuery();

  const createMutation = useCreateUserMutation();
  const updateMutation = useUpdateUserMutation();
  const deleteMutation = useDeleteUserMutation();

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingUser, setEditingUser] = useState(null);

  function openCreate() {
    setEditingUser(null);
    setModalMode("create");
  }

  function openEdit(u) {
    setEditingUser(u);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingUser(null);
  }

  async function handleCreate(body) {
    await createMutation.mutateAsync(body);
    closeModal();
  }

  async function handleUpdate(body) {
    await updateMutation.mutateAsync({ id: editingUser.id, ...body });
    closeModal();
  }

  async function handleDeletePlayer(u) {
    if (
      !window.confirm(
        `Delete player "${u.fullname}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await deleteMutation.mutateAsync(u.id);
  }

  const { items = [], total = 0, totalPages = 1 } = usersQuery.data ?? {};
  const visibleItems =
    activeTab === "staff" && !roleFilter ? items.filter((u) => u.role !== "PLAYER") : items;

  const roleFilterOptions = (metaQuery.data?.roles ?? [])
    .filter((r) => r.name !== "PLAYER")
    .map((r) => ({
    value: r.name,
    label: r.name,
    }));

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="w-full">
          <div className="mb-3 inline-flex rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab("staff");
                setPage(1);
              }}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                activeTab === "staff"
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Staff
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("players");
                setRoleFilter("");
                setPage(1);
              }}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                activeTab === "players"
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Players
            </button>
          </div>
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {activeTab === "players"
              ? `${total} player${total !== 1 ? "s" : ""} total`
              : `${visibleItems.length} user${visibleItems.length !== 1 ? "s" : ""} on this page`}
          </p>
        </div>
        {activeTab === "staff" && (
          <PrimaryButton onClick={openCreate} className="w-auto">
            + New user
          </PrimaryButton>
        )}
      </div>

      {/* Filters */}
      <PanelCard className="mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextInput
            label="Search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Name, username, phone, or email"
          />
          {activeTab === "staff" ? (
            <SelectInput
              label="Role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              options={roleFilterOptions}
              placeholder="All staff roles"
            />
          ) : (
            <TextInput label="Role" value="PLAYER" disabled readOnly />
          )}
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            options={[
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ]}
            placeholder="All"
          />
        </div>
      </PanelCard>

      {/* Table */}
      <PanelCard className="overflow-x-auto">
        {usersQuery.isLoading ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">Loading users...</p>
        ) : usersQuery.isError ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--danger)]">
            {usersQuery.error?.message || "Failed to load users"}
          </p>
        ) : visibleItems.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">No users found.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surfaceMuted)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.fullname}</p>
                    <p className="text-xs text-[var(--muted)]">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{u.username || "—"}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{u.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <Tag>{ROLE_LABELS[u.role] || u.role}</Tag>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${u.status ? "bg-green-500" : "bg-[var(--danger)]"}`}
                    />{" "}
                    <span className="text-xs text-[var(--muted)]">
                      {u.status ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]"
                      >
                        Edit
                      </button>
                      {activeTab === "players" && (
                        <button
                          type="button"
                          onClick={() => handleDeletePlayer(u)}
                          disabled={deleteMutation.isPending}
                          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)] disabled:opacity-40"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelCard>

      {/* Pagination */}
      {totalPages > 1 && (
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
      )}

      {/* Create / Edit modal */}
      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "edit" ? "Edit user" : "New user"}
      >
        <UserForm
          key={editingUser?.id ?? "create"}
          meta={metaQuery.data}
          initialValues={modalMode === "edit" ? editingUser : null}
          onSubmit={modalMode === "edit" ? handleUpdate : handleCreate}
          isPending={createMutation.isPending || updateMutation.isPending}
          submitLabel={modalMode === "edit" ? "Save changes" : "Create user"}
          currentUserRole={user?.role}
        />
      </Modal>
    </AdminShell>
  );
}
