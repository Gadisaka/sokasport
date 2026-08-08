import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { apiRequest } from "../../hook/useApiRequest";

const TERMINAL_STATUSES = ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"];

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function formatWaitHours(hours) {
  if (hours == null) return "—";
  return hours >= 1 ? `${Math.round(hours)}h left` : "<1h left";
}

function canOverrideResult(role) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function SummaryCards({ summary }) {
  const cards = [
    { label: "Editable fixtures", value: summary?.total ?? 0 },
    { label: "Locked", value: summary?.locked ?? 0 },
    { label: "Stuck settlement", value: summary?.stuck ?? 0 },
    { label: "Live / HT", value: summary?.live ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {cards.map((card) => (
        <PanelCard key={card.label} className="p-3">
          <p className="text-xs text-(--muted)">{card.label}</p>
          <p className="mt-1 text-lg font-semibold">{card.value}</p>
        </PanelCard>
      ))}
    </div>
  );
}

function editableQuerySuffix(includeIncompletePast) {
  return includeIncompletePast ? "?includeIncompletePast=true" : "";
}

function FixtureEditor({ detail, onClose, onSaved, allowOverride, includeIncompletePast }) {
  const fixture = detail?.fixture;
  const marketGroups = useMemo(
    () => detail?.marketGroups || [],
    [detail?.marketGroups],
  );
  const [status, setStatus] = useState(fixture?.status || "FT");
  const [homeScore, setHomeScore] = useState(
    fixture?.homeScore != null ? String(fixture.homeScore) : "",
  );
  const [awayScore, setAwayScore] = useState(
    fixture?.awayScore != null ? String(fixture.awayScore) : "",
  );
  const [winners, setWinners] = useState({});
  const [force, setForce] = useState(Boolean(fixture?.gradingCompletedAt));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!fixture) return;
    setStatus(fixture.status || "FT");
    setHomeScore(fixture.homeScore != null ? String(fixture.homeScore) : "");
    setAwayScore(fixture.awayScore != null ? String(fixture.awayScore) : "");
    setForce(Boolean(fixture.gradingCompletedAt));

    const initial = {};
    for (const group of marketGroups) {
      const w = group.currentOverride?.winningSelections?.[0];
      if (w) initial[group.key] = w;
    }
    setWinners(initial);
  }, [fixture, marketGroups]);

  function setWinner(groupKey, value) {
    setWinners((prev) => ({ ...prev, [groupKey]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!allowOverride) return;
    setError("");
    setSubmitting(true);

    const marketOverrides = {};
    for (const group of marketGroups) {
      const winner = winners[group.key];
      if (!winner) continue;
      marketOverrides[group.key] = {
        marketCode: group.marketCode,
        marketParams: group.marketParams,
        marketLabel: group.marketLabel,
        winningSelections: [winner],
      };
    }

    try {
      const payload = await apiRequest(
        `/admin/fixtures/${fixture.id}/market-results${editableQuerySuffix(includeIncompletePast)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            homeScore: homeScore === "" ? null : Number(homeScore),
            awayScore: awayScore === "" ? null : Number(awayScore),
            marketOverrides,
            force,
            resetLegs: force,
          }),
        },
      );
      onSaved(payload?.message || "Saved");
      onClose();
    } catch (err) {
      if (err?.status === 409) setForce(true);
      setError(err?.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  if (!fixture) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-(--border) bg-(--surface) shadow-xl">
        <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold">Edit fixture results</h3>
            <p className="text-sm text-(--muted)">
              {fixture.homeTeam} vs {fixture.awayTeam}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-(--border) px-2 py-1 text-sm"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <PanelCard className="p-3 text-sm">
              <p>
                <span className="font-semibold">API:</span> {fixture.apiFixtureId} ·{" "}
                {fixture.league}
              </p>
              <p className="text-(--muted)">
                Kickoff {formatDateTime(fixture.startTime)} · {detail?.stats?.totalLegs ?? 0}{" "}
                legs ({detail?.stats?.pendingLegs ?? 0} pending)
              </p>
            </PanelCard>

            <div className="grid grid-cols-3 gap-2">
              <label className="text-sm">
                <span className="font-semibold">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-(--border) bg-(--surface) px-2 py-1.5"
                >
                  {TERMINAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="font-semibold">Home</span>
                <input
                  type="number"
                  min={0}
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-(--border) px-2 py-1.5 font-mono"
                />
              </label>
              <label className="text-sm">
                <span className="font-semibold">Away</span>
                <input
                  type="number"
                  min={0}
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-(--border) px-2 py-1.5 font-mono"
                />
              </label>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Markets — pick winning selection</h4>
              <div className="space-y-3">
                {marketGroups.length === 0 ? (
                  <p className="text-sm text-(--muted)">No markets found for this fixture.</p>
                ) : (
                  marketGroups.map((group) => (
                    <PanelCard key={group.key} className="p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">{group.marketLabel}</p>
                          <p className="text-xs font-mono text-(--muted)">
                            {group.marketCode}
                            {group.marketParams
                              ? ` · ${JSON.stringify(group.marketParams)}`
                              : ""}
                          </p>
                        </div>
                        <span className="rounded-sm bg-(--surfaceMuted) px-2 py-0.5 text-xs">
                          {group.ticketLegCount} legs
                        </span>
                      </div>
                      {group.legacy ? (
                        <p className="mb-2 text-xs text-amber-700">
                          Legacy legs without market code — override may not apply.
                        </p>
                      ) : null}
                      <div className="space-y-1">
                        {group.selectionOptions.map((option) => (
                          <label
                            key={`${group.key}-${option}`}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name={`market-${group.key}`}
                              checked={winners[group.key] === option}
                              onChange={() => setWinner(group.key, option)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </PanelCard>
                  ))
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Force re-grade all legs (resets resolved legs to pending)
            </label>

            {error ? <p className="text-sm text-(--danger)">{error}</p> : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-(--border) p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-(--border) px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            {allowOverride ? (
              <button
                type="submit"
                disabled={submitting}
                className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Save & re-settle"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

export default function FixtureOpsPage() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listFilter, setListFilter] = useState("");
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const allowOverride = useMemo(() => canOverrideResult(user?.role), [user?.role]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "30",
        editableOnly: "true",
      });
      if (q.trim()) params.set("q", q.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (listFilter) params.set("filter", listFilter);
      if (listFilter === "incomplete_past") {
        params.set("includeIncompletePast", "true");
      }

      const summaryParams = new URLSearchParams({ editableOnly: "true" });
      if (listFilter === "incomplete_past") {
        summaryParams.set("includeIncompletePast", "true");
        summaryParams.set("filter", "incomplete_past");
      }

      const [summaryPayload, listPayload] = await Promise.all([
        apiRequest(`/admin/fixtures/summary?${summaryParams.toString()}`),
        apiRequest(`/admin/fixtures?${params.toString()}`),
      ]);
      setSummary(summaryPayload);
      setItems(Array.isArray(listPayload?.items) ? listPayload.items : []);
      setTotalPages(Number(listPayload?.totalPages) > 0 ? Number(listPayload.totalPages) : 1);
    } catch (err) {
      if (err?.status === 401) {
        logout();
        return;
      }
      setError(err?.message || "Failed to load fixtures");
    } finally {
      setLoading(false);
    }
  }, [listFilter, logout, page, q, statusFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function openEditor(fixtureId) {
    setDetailLoading(true);
    setError("");
    try {
      const suffix =
        listFilter === "incomplete_past" ? "?includeIncompletePast=true" : "";
      const payload = await apiRequest(`/admin/fixtures/${fixtureId}${suffix}`);
      setDetail(payload);
      setEditId(fixtureId);
    } catch (err) {
      if (err?.status === 401) {
        logout();
        return;
      }
      setError(err?.message || "Failed to load fixture");
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleUnlock(row) {
    if (!window.confirm("Clear lock and market overrides for this fixture?")) return;
    try {
      const payload = await apiRequest(`/admin/fixtures/${row.id}/unlock`, {
        method: "POST",
      });
      setActionMessage(payload?.message || "Unlocked");
      await loadList();
    } catch (err) {
      if (err?.status === 401) logout();
      else setError(err?.message || "Failed to unlock");
    }
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold">Fixture Operations</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Edit completed fixtures (FT, void, etc.) or past-day matches still LIVE/HT.
            Use the preset below for past kickoffs still marked NS.
          </p>
        </div>

        <SummaryCards summary={summary} />

        <PanelCard className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Search</span>
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="API id, team, fixture id"
                className="min-w-[220px] rounded-sm border border-(--border) bg-(--surface) px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-sm border border-(--border) bg-(--surface) px-2 py-1.5"
              >
                <option value="">All</option>
                {["NS", "LIVE", "HT", ...TERMINAL_STATUSES].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Preset</span>
              <select
                value={listFilter}
                onChange={(e) => {
                  setListFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-sm border border-(--border) bg-(--surface) px-2 py-1.5"
              >
                <option value="">Completed / in-play</option>
                <option value="stuck">Stuck settlement</option>
                <option value="locked">Admin locked</option>
                <option value="incomplete_past">Past kickoff still NS</option>
              </select>
            </label>
            <button
              type="button"
              onClick={loadList}
              className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white"
            >
              Refresh
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-(--danger)">{error}</p> : null}
          {actionMessage ? (
            <p className="mt-2 text-sm text-emerald-600">{actionMessage}</p>
          ) : null}
          {detailLoading ? (
            <p className="mt-2 text-sm text-(--muted)">Loading fixture editor…</p>
          ) : null}
        </PanelCard>

        <PanelCard className="overflow-x-auto p-0">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b border-(--border) text-xs uppercase tracking-wide text-(--muted)">
                <th className="px-3 py-2 font-semibold">Match</th>
                <th className="px-3 py-2 font-semibold">Kickoff</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Score</th>
                <th className="px-3 py-2 font-semibold">Legs</th>
                <th className="px-3 py-2 font-semibold">Settlement</th>
                <th className="px-3 py-2 font-semibold">Lock</th>
                {allowOverride ? (
                  <th className="px-3 py-2 font-semibold">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={allowOverride ? 8 : 7} className="px-3 py-6 text-(--muted)">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={allowOverride ? 8 : 7} className="px-3 py-6 text-(--muted)">
                    No editable fixtures found.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-(--border)/60">
                    <td className="px-3 py-2">
                      <p className="font-semibold">
                        {row.homeTeam} vs {row.awayTeam}
                      </p>
                      <p className="text-xs text-(--muted)">
                        {row.league} · API {row.apiFixtureId}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDateTime(row.startTime)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.status}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.homeScore ?? "—"} - {row.awayScore ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.selectionCount}
                      {row.pendingLegs > 0 ? (
                        <span className="ml-1 text-amber-700">({row.pendingLegs} pending)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.postponedWaiting ? (
                        <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 text-sky-800">
                          Postponed · {formatWaitHours(row.waitHoursRemaining)}
                        </span>
                      ) : row.stuckSettlement ? (
                        <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800">
                          Stuck
                        </span>
                      ) : row.gradingCompletedAt ? (
                        <span className="text-emerald-700">Done</span>
                      ) : (
                        <span className="text-(--muted)">Pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.resultLockedAt ? (
                        <span className="rounded-sm bg-indigo-100 px-1.5 py-0.5 text-indigo-800">
                          Locked
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {allowOverride ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={!row.editable}
                            onClick={() => openEditor(row.id)}
                            className="rounded-sm border border-(--border) px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          >
                            Edit markets
                          </button>
                          {row.resultLockedAt ? (
                            <button
                              type="button"
                              onClick={() => handleUnlock(row)}
                              className="rounded-sm border border-(--border) px-2 py-1 text-xs font-semibold"
                            >
                              Unlock
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="flex justify-end gap-2 border-t border-(--border) px-4 py-3 text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </PanelCard>
      </div>

      {editId && detail ? (
        <FixtureEditor
          detail={detail}
          includeIncompletePast={listFilter === "incomplete_past"}
          allowOverride={allowOverride}
          onClose={() => {
            setEditId(null);
            setDetail(null);
          }}
          onSaved={(msg) => {
            setActionMessage(msg);
            loadList();
          }}
        />
      ) : null}
    </AdminShell>
  );
}
