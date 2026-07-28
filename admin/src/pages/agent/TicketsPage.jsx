import { Fragment, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import {
  useAgentTicketDetailQuery,
  useAgentTicketsQuery,
} from "../../hook/useAgentOperations";

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function TicketSlipDetail({ ticket }) {
  if (!ticket) return null;

  return (
    <div className="overflow-hidden rounded-sm border border-(--border) bg-(--surfaceMuted)/40">
      <div className="border-b border-(--border) px-3 py-2 text-xs font-semibold uppercase tracking-wide text-(--muted)">
        Slip — {ticket.couponNumber}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Selection</th>
              <th className="px-3 py-2">Odd</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {(ticket.selections || []).map((selection) => (
              <tr key={selection.id} className="border-b border-(--border)/60 last:border-0">
                <td className="px-3 py-2 text-xs text-(--muted)">
                  {selection.match?.startTime
                    ? formatDateTime(selection.match.startTime)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {selection.match
                    ? `${selection.match.homeTeam} vs ${selection.match.awayTeam}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs">{selection.selection}</td>
                <td className="px-3 py-2 font-mono text-xs">{toNumber(selection.odds).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs font-mono">{selection.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-(--border) px-3 py-3 text-sm">
        <p>
          <span className="font-semibold">Stake:</span> {toNumber(ticket.stake).toLocaleString()} ETB
        </p>
        <p>
          <span className="font-semibold">Total odds:</span> {toNumber(ticket.totalOdds).toFixed(2)}
        </p>
        <p>
          <span className="font-semibold">Potential win:</span>{" "}
          {toNumber(ticket.potentialWin).toLocaleString()} ETB
        </p>
        <p>
          <span className="font-semibold">Status:</span>{" "}
          <span className="font-mono">{ticket.status}</span>
        </p>
      </div>
    </div>
  );
}

export default function AgentTicketsPage() {
  const { user, logout } = useAuth();
  const today = useMemo(() => formatYmd(new Date()), []);
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("");
  const [couponNumber, setCouponNumber] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [applied, setApplied] = useState({
    date: today,
    status: "",
    couponNumber: "",
  });

  const query = useAgentTicketsQuery({
    page,
    limit: 20,
    date: applied.date,
    status: applied.status,
    couponNumber: applied.couponNumber,
    enabled: true,
  });

  const detailQuery = useAgentTicketDetailQuery(expandedId, {
    enabled: Boolean(expandedId),
  });

  const items = Array.isArray(query.data?.items) ? query.data.items : [];
  const totalPages = Number(query.data?.totalPages || 1);

  function onApply(event) {
    event.preventDefault();
    setPage(1);
    setExpandedId(null);
    setApplied({
      date,
      status,
      couponNumber: couponNumber.trim(),
    });
  }

  function toggleRow(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">Tickets</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Agent-scoped ticket feed across your assigned cashiers. Click a row for slip details.
          </p>
        </div>

        <PanelCard className="p-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={onApply}>
            <label className="text-xs text-(--muted)">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              />
            </label>
            <label className="text-xs text-(--muted)">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              >
                <option value="">All</option>
                <option value="OPEN">Open (not printed)</option>
                <option value="PRINTED">Printed (sold)</option>
                <option value="WON">Won</option>
                <option value="LOST">Lost</option>
                <option value="PAID">Paid</option>
                <option value="CASHBACK_PAID">Cashback paid</option>
                <option value="VOID">Void</option>
                <option value="CANCELED">Canceled</option>
              </select>
            </label>
            <label className="text-xs text-(--muted)">
              Coupon
              <input
                type="text"
                value={couponNumber}
                onChange={(e) => setCouponNumber(e.target.value)}
                placeholder="Optional coupon number"
                className="mt-1 block rounded-sm border border-(--border) bg-(--surface) px-2.5 py-1.5 text-sm text-(--text)"
              />
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
              Failed to load tickets.
            </div>
          ) : null}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                <th className="px-4 py-3 w-8" aria-hidden />
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Coupon</th>
                <th className="px-4 py-3 font-semibold">Branch</th>
                <th className="px-4 py-3 font-semibold">Stake</th>
                <th className="px-4 py-3 font-semibold">Potential Win</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    Loading tickets...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-(--muted)" colSpan={7}>
                    No tickets found for this filter.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const open = expandedId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={`cursor-pointer border-b border-(--border)/60 hover:bg-(--surfaceMuted) ${open ? "bg-(--surfaceMuted)/60" : ""}`}
                        onClick={() => toggleRow(item.id)}
                      >
                        <td className="px-4 py-3 text-(--muted)">{open ? "▼" : "▶"}</td>
                        <td className="px-4 py-3">{formatDateTime(item.created_at)}</td>
                        <td className="px-4 py-3 font-mono">{item.coupon_number}</td>
                        <td className="px-4 py-3">{item.branch_name || "-"}</td>
                        <td className="px-4 py-3">
                          {Number(item.stake || 0).toLocaleString()} ETB
                        </td>
                        <td className="px-4 py-3">
                          {Number(item.potential_win || 0).toLocaleString()} ETB
                        </td>
                        <td className="px-4 py-3">{item.status}</td>
                      </tr>
                      {open ? (
                        <tr key={`${item.id}-detail`} className="border-b border-(--border)/60 bg-(--surface)/80">
                          <td colSpan={7} className="px-4 py-4">
                            {detailQuery.isLoading ? (
                              <p className="text-sm text-(--muted)">Loading slip...</p>
                            ) : detailQuery.isError ? (
                              <p className="text-sm text-rose-600 dark:text-rose-400">
                                Could not load slip details.
                              </p>
                            ) : (
                              <TicketSlipDetail ticket={detailQuery.data} />
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-(--border) px-4 py-3 text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => {
                  setExpandedId(null);
                  setPage((value) => Math.max(1, value - 1));
                }}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-(--muted)">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => {
                  setExpandedId(null);
                  setPage((value) => value + 1);
                }}
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
