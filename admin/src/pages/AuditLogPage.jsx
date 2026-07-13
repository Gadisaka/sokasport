import { useDeferredValue, useState } from "react";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import TextInput from "../components/ui/TextInput";
import SelectInput from "../components/ui/SelectInput";
import { useAuditLogsQuery } from "../hook/useAuditLogs";

const MODULE_OPTIONS = [
  { value: "AUTH", label: "Auth" },
  { value: "AGENTS_CASHIERS", label: "Agents & Cashiers" },
];

export default function AuditLogPage() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandedIds, setExpandedIds] = useState({});
  const deferredSearch = useDeferredValue(search);

  const query = useAuditLogsQuery({
    page,
    search: deferredSearch,
    module,
    action,
    from: fromDate,
    to: toDate,
  });
  const { items = [], totalPages = 1 } = query.data ?? {};

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Audit Log</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Complete activity trail for authentication and admin actions.
        </p>
      </div>

      <PanelCard className="mb-4">
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <TextInput
            label="Search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Action, module, entity type/id"
          />
          <SelectInput
            label="Module"
            value={module}
            onChange={(e) => {
              setModule(e.target.value);
              setPage(1);
            }}
            options={MODULE_OPTIONS}
            placeholder="All modules"
          />
          <TextInput
            label="Action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="e.g. CASHIER_UPDATED"
          />
          <TextInput
            label="From date"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
          <TextInput
            label="To date"
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </PanelCard>

      <PanelCard className="overflow-x-auto">
        {query.isLoading ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">
            Loading logs...
          </p>
        ) : query.isError ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--danger)]">
            {query.error?.message || "Failed to load audit logs"}
          </p>
        ) : items.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-[var(--muted)]">
            No log entries found.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Changes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id} className="border-b border-[var(--border)] align-top last:border-0">
                  <td className="px-4 py-3 text-xs">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{log.user?.fullname || "System/Unknown"}</p>
                    <p className="text-xs text-[var(--muted)]">{log.actor_role || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs text-[var(--muted)]">{log.module}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{log.entity_type || "—"}</p>
                    <p className="font-mono text-xs text-[var(--muted)]">{log.entity_id || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIds((prev) => ({ ...prev, [log.id]: !prev[log.id] }))
                      }
                      className="mb-2 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold"
                    >
                      {expandedIds[log.id] ? "Hide diff" : "View diff"}
                    </button>
                    {expandedIds[log.id] && (
                      <DiffView before={log.before} after={log.after} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelCard>

      <Pagination page={page} totalPages={totalPages} setPage={setPage} />
    </AdminShell>
  );
}

function DiffView({ before, after }) {
  const rows = buildDiffRows(before, after);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--muted)]">
        No field-level changes captured.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.path} className="rounded-sm bg-[var(--surfaceMuted)] p-2 text-xs">
          <p className="font-mono">{row.path}</p>
          <p className="text-[var(--danger)]">- {row.before}</p>
          <p className="text-green-600">+ {row.after}</p>
        </div>
      ))}
    </div>
  );
}

function buildDiffRows(before, after) {
  const result = [];
  walkDiff(before, after, "", result);
  return result;
}

function walkDiff(before, after, path, out) {
  const isObjBefore = before && typeof before === "object";
  const isObjAfter = after && typeof after === "object";

  if (!isObjBefore || !isObjAfter || Array.isArray(before) || Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push({
        path: path || "(root)",
        before: stringifyValue(before),
        after: stringifyValue(after),
      });
    }
    return;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const nextPath = path ? `${path}.${key}` : key;
    walkDiff(before[key], after[key], nextPath, out);
  }
}

function stringifyValue(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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
