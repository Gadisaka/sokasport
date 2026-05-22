import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import { apiRequest } from "../../hook/useApiRequest";

function fmtAgo(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const s = Math.max(0, Number(seconds));
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.round(s / 60)}m`;
}

export default function ValidationOpsPage() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveRows, setLiveRows] = useState([]);
  const [validationRows, setValidationRows] = useState([]);
  const [placementLogs, setPlacementLogs] = useState([]);
  const [reasonFilter, setReasonFilter] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [rateLimits, setRateLimits] = useState(null);
  const [walletLocks, setWalletLocks] = useState(null);
  const [actionMsg, setActionMsg] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [livePayload, ticketPayload, metricsPayload, placementPayload] = await Promise.all([
        apiRequest("/admin/validation/live-odds?limit=80"),
        apiRequest("/admin/validation/tickets?limit=40"),
        apiRequest("/admin/validation/metrics"),
        apiRequest(
          `/admin/validation/placement-logs?limit=40${
            reasonFilter ? `&reason=${encodeURIComponent(reasonFilter)}` : ""
          }`,
        ),
      ]);
      setLiveRows(Array.isArray(livePayload?.items) ? livePayload.items : []);
      setValidationRows(Array.isArray(ticketPayload?.items) ? ticketPayload.items : []);
      setMetrics(metricsPayload?.metrics || null);
      setRateLimits(metricsPayload?.rateLimits || null);
      setWalletLocks(metricsPayload?.walletLocks || null);
      setPlacementLogs(Array.isArray(placementPayload?.items) ? placementPayload.items : []);
    } catch (err) {
      setError(err?.message || "Failed to load validation operations data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [reasonFilter]);

  const staleCount = useMemo(
    () => liveRows.filter((row) => row.stale).length,
    [liveRows],
  );

  async function handleResync(apiFixtureId) {
    try {
      const payload = await apiRequest(
        `/admin/validation/live-odds/${apiFixtureId}/resync`,
        { method: "POST" },
      );
      setActionMsg(payload?.message || "Resync queued");
      await reload();
    } catch (err) {
      setError(err?.message || "Failed to force resync");
    }
  }

  async function handleSetState(apiFixtureId, targetState) {
    const marketKey = window.prompt(
      "Enter market key as `Market Name|Selection` (example: Match Winner|Home)",
    );
    if (!marketKey) return;
    try {
      const payload = await apiRequest(
        `/admin/validation/live-odds/${apiFixtureId}/market-state`,
        {
          method: "PATCH",
          body: JSON.stringify({ marketKey, state: targetState }),
        },
      );
      setActionMsg(payload?.message || "State updated");
      await reload();
    } catch (err) {
      setError(err?.message || "Failed to set market state");
    }
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold">Validation &amp; Odds Monitoring</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Live odds health, ticket validation failures, and market controls.
          </p>
        </div>

        <PanelCard className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[var(--muted)]">
              {loading ? "Refreshing..." : `${liveRows.length} live fixtures`} ·{" "}
              {staleCount} stale snapshots
            </div>
            <button
              type="button"
              onClick={reload}
              className="rounded-sm bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white"
            >
              Refresh
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}
          {actionMsg ? <p className="mt-2 text-sm text-emerald-600">{actionMsg}</p> : null}
        </PanelCard>

        {metrics ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-11">
            <MetricCard label="Total Validations" value={metrics.total} />
            <MetricCard label="Conflicts" value={metrics.conflicts} />
            <MetricCard label="Failed" value={metrics.failed} />
            <MetricCard label="Success" value={metrics.success} />
            <MetricCard
              label="Avg Latency"
              value={`${Number(metrics.avgLatencyMs || 0).toFixed(1)} ms`}
            />
            <MetricCard label="Wallet Busy" value={metrics.byCode?.wallet_busy || 0} />
            <MetricCard label="Rate Limited" value={metrics.byCode?.rate_limited || 0} />
            <MetricCard label="Version Changed" value={metrics.byCode?.market_version_changed || 0} />
            <MetricCard label="RL Blocked" value={rateLimits?.blocked ?? 0} />
            <MetricCard label="Wallet Lock Busy" value={walletLocks?.lockBusy ?? 0} />
            <MetricCard label="Wallet Avg Wait" value={`${Number(walletLocks?.avgWaitMs || 0).toFixed(1)} ms`} />
          </div>
        ) : null}

        <PanelCard className="p-4">
          <h3 className="mb-3 text-base font-semibold">Live Odds Monitor</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-2 py-2 font-semibold">Fixture</th>
                  <th className="px-2 py-2 font-semibold">State</th>
                  <th className="px-2 py-2 font-semibold">Redis Age</th>
                  <th className="px-2 py-2 font-semibold">Odds Entries</th>
                  <th className="px-2 py-2 font-semibold">Version</th>
                  <th className="px-2 py-2 font-semibold">Version Updated</th>
                  <th className="px-2 py-2 font-semibold">Lock Remaining</th>
                  <th className="px-2 py-2 font-semibold">Stale</th>
                  <th className="px-2 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liveRows.map((row) => (
                  <tr key={row.apiFixtureId} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-semibold">
                        {row.homeTeam} vs {row.awayTeam}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{row.league}</div>
                    </td>
                    <td className="px-2 py-2">{row.marketState}</td>
                    <td className="px-2 py-2">{fmtAgo(row.redisCacheAgeSeconds)}</td>
                    <td className="px-2 py-2">{row.redisOddsEntries}</td>
                    <td className="px-2 py-2">{row.marketVersion ?? "—"}</td>
                    <td className="px-2 py-2">
                      {row.lastVersionChangeAt
                        ? new Date(row.lastVersionChangeAt).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {row.lockRemainingMs > 0 ? `${Math.ceil(row.lockRemainingMs / 1000)}s` : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {row.stale ? (
                        <span className="rounded-sm bg-red-100 px-2 py-0.5 text-red-700">Yes</span>
                      ) : (
                        <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-emerald-700">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => handleResync(row.apiFixtureId)}
                          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold"
                        >
                          Re-sync
                        </button>
                        {["LOCKED", "SUSPENDED", "OPEN", "CLOSED"].map((state) => (
                          <button
                            key={`${row.apiFixtureId}-${state}`}
                            type="button"
                            onClick={() => handleSetState(row.apiFixtureId, state)}
                            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold"
                          >
                            {state}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>

        <PanelCard className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">Ticket Validation Monitor</h3>
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
            >
              <option value="">All reasons</option>
              <option value="odds_changed">odds_changed</option>
              <option value="market_locked">market_locked</option>
              <option value="market_suspended">market_suspended</option>
              <option value="market_version_changed">market_version_changed</option>
              <option value="fixture_started">fixture_started</option>
              <option value="wallet_busy">wallet_busy</option>
              <option value="rate_limited">rate_limited</option>
            </select>
          </div>
          <div className="space-y-2">
            {validationRows.map((row) => (
              <div
                key={row.id}
                className="rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{row.code || "validation"}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {row.action} · {row.actorRole} · {row.actorName}
                </div>
              </div>
            ))}
            {!validationRows.length ? (
              <p className="text-sm text-[var(--muted)]">No recent validation failures.</p>
            ) : null}
          </div>
        </PanelCard>

        <PanelCard className="p-4">
          <h3 className="mb-3 text-base font-semibold">Placement Validation Logs</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-2 py-2 font-semibold">Time</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Reason</th>
                  <th className="px-2 py-2 font-semibold">Role</th>
                  <th className="px-2 py-2 font-semibold">Fixtures</th>
                  <th className="px-2 py-2 font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody>
                {placementLogs.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-2 py-2">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">{row.rejection_reason || "—"}</td>
                    <td className="px-2 py-2">{row.actor_role || "—"}</td>
                    <td className="px-2 py-2">
                      {Array.isArray(row.fixture_ids) ? row.fixture_ids.join(", ") : "—"}
                    </td>
                    <td className="px-2 py-2">{row.validation_latency_ms ?? 0}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </div>
    </AdminShell>
  );
}

function MetricCard({ label, value }) {
  return (
    <PanelCard className="p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </PanelCard>
  );
}
