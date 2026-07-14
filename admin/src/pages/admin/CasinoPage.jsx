import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import {
  useCasinoGamesQuery,
  useCasinoReportsQuery,
  useCasinoStatusQuery,
  useSyncCasinoCatalogMutation,
  useUpdateCasinoGameMutation,
  useUpdateCasinoStatusMutation,
} from "../../hook/useCasinoGames";

const TABS = [
  { key: "games", label: "Games" },
  { key: "reports", label: "Reports" },
];

const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function getPresetDates(key) {
  const now = new Date();
  const today = formatYmd(now);
  if (key === "today") return { from: today, to: today };
  if (key === "last7") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: formatYmd(d), to: today };
  }
  if (key === "last30") {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return { from: formatYmd(d), to: today };
  }
  return { from: today, to: today };
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CasinoPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("games");

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Casino Management</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage the InOut game catalog, view reports, and control casino availability.
        </p>
      </div>

      <MasterSwitchPanel />

      <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-sm border px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surfaceMuted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "games" ? <GamesTab /> : <ReportsTab />}
    </AdminShell>
  );
}

function GamesTab() {
  const games = useCasinoGamesQuery();
  const syncMutation = useSyncCasinoCatalogMutation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");

  const list = games.data ?? [];

  const stats = useMemo(() => {
    const total = list.length;
    const enabled = list.filter((g) => g.enabled).length;
    return { total, enabled, disabled: total - enabled };
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((g) => {
      if (statusFilter === "enabled" && !g.enabled) return false;
      if (statusFilter === "disabled" && g.enabled) return false;
      if (!q) return true;
      return (
        String(g.title || "").toLowerCase().includes(q) ||
        String(g.game_mode || "").toLowerCase().includes(q)
      );
    });
  }, [list, search, statusFilter]);

  async function handleSync() {
    setSyncMessage("");
    setSyncError("");
    try {
      const result = await syncMutation.mutateAsync();
      setSyncMessage(
        `Synced ${result?.total ?? 0} games (${result?.created ?? 0} new, ${result?.updated ?? 0} updated).`,
      );
      setTimeout(() => setSyncMessage(""), 5000);
    } catch (err) {
      setSyncError(err?.message || "Failed to sync catalog from InOut");
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total games" value={stats.total} />
          <StatCard label="Enabled" value={stats.enabled} accent="green" />
          <StatCard label="Disabled" value={stats.disabled} accent="muted" />
        </div>
        <PrimaryButton
          type="button"
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="w-auto shrink-0"
        >
          {syncMutation.isPending ? "Syncing…" : "Sync from InOut"}
        </PrimaryButton>
      </div>

      {(syncMessage || syncError) && (
        <div className="mb-4">
          {syncMessage && (
            <p className="text-xs font-medium text-green-600">{syncMessage}</p>
          )}
          {syncError && (
            <p className="text-xs font-medium text-[var(--danger)]">
              {syncError}
            </p>
          )}
        </div>
      )}

      <PanelCard className="p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or game mode…"
            className="min-w-[200px] flex-1 rounded-sm border border-[var(--border)] bg-[var(--bgApp)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-1">
            {["all", "enabled", "disabled"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-sm border px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                  statusFilter === s
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surfaceMuted)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {games.isLoading ? (
          <p className="py-10 text-center text-sm text-[var(--muted)]">
            Loading games…
          </p>
        ) : games.isError ? (
          <p className="py-10 text-center text-sm text-[var(--danger)]">
            {games.error?.message || "Failed to load games"}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--muted)]">
            {list.length === 0
              ? 'No games yet. Click "Sync from InOut" to populate the catalog.'
              : "No games match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <Th>Game</Th>
                  <Th>Game mode</Th>
                  <Th className="text-center">RTP</Th>
                  <Th className="text-center">Multiplayer</Th>
                  <Th className="text-center">Order</Th>
                  <Th className="text-center">Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((game) => (
                  <GameRow key={game.id} game={game} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </>
  );
}

function ReportsTab() {
  const today = useMemo(() => formatYmd(new Date()), []);
  const [datePreset, setDatePreset] = useState("today");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ from: today, to: today });

  const reports = useCasinoReportsQuery({
    from: appliedRange.from,
    to: appliedRange.to,
  });

  function applyPreset(key) {
    setDatePreset(key);
    const { from, to } = getPresetDates(key);
    setFromDate(from);
    setToDate(to);
    setAppliedRange({ from, to });
  }

  function applyCustomRange() {
    setDatePreset("");
    setAppliedRange({ from: fromDate, to: toDate });
  }

  const summary = reports.data?.summary || {};
  const byDay = reports.data?.byDay || [];
  const topPlayers = reports.data?.topPlayers || [];

  return (
    <>
      <PanelCard className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={`rounded-sm border px-3 py-2 text-xs font-semibold transition-colors ${
                  datePreset === p.key
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surfaceMuted)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setDatePreset("");
              }}
              className="rounded-sm border border-[var(--border)] bg-[var(--bgApp)] px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-[var(--muted)]">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setDatePreset("");
              }}
              className="rounded-sm border border-[var(--border)] bg-[var(--bgApp)] px-2 py-1.5 text-sm"
            />
            <PrimaryButton
              type="button"
              onClick={applyCustomRange}
              className="w-auto px-3 py-1.5 text-xs"
            >
              Apply
            </PrimaryButton>
          </div>
        </div>
      </PanelCard>

      {reports.isLoading ? (
        <p className="py-10 text-center text-sm text-[var(--muted)]">
          Loading reports…
        </p>
      ) : reports.isError ? (
        <p className="py-10 text-center text-sm text-[var(--danger)]">
          {reports.error?.message || "Failed to load reports"}
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total bets" value={summary.totalBets || 0} />
            <StatCard
              label="Bet volume"
              value={`ETB ${money(summary.totalBetAmount)}`}
            />
            <StatCard
              label="Payouts"
              value={`ETB ${money(summary.totalWinAmount)}`}
            />
            <StatCard
              label="GGR"
              value={`ETB ${money(summary.ggr)}`}
              accent={summary.ggr >= 0 ? "green" : "danger"}
            />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Unique players" value={summary.uniquePlayers || 0} />
            <StatCard label="Wins paid" value={summary.totalWins || 0} />
            <StatCard label="Rollbacks" value={summary.totalRollbacks || 0} />
            <StatCard
              label="Rollback amount"
              value={`ETB ${money(summary.totalRollbackAmount)}`}
              accent="muted"
            />
          </div>

          <PanelCard className="mb-4 p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Daily breakdown
            </h3>
            {byDay.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                No activity in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left">
                      <Th>Date</Th>
                      <Th className="text-right">Bets</Th>
                      <Th className="text-right">Bet amount</Th>
                      <Th className="text-right">Wins</Th>
                      <Th className="text-right">Win amount</Th>
                      <Th className="text-right">Rollbacks</Th>
                      <Th className="text-right">GGR</Th>
                      <Th className="text-right">Players</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay.map((d) => (
                      <tr
                        key={d.date}
                        className="border-b border-[var(--border)] last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">{d.date}</span>
                          <span className="ml-1 text-xs text-[var(--muted)]">
                            {d.dayLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {d.bets}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(d.betAmount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {d.wins}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(d.winAmount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                          {d.rollbacks}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            d.ggr >= 0 ? "text-green-600" : "text-[var(--danger)]"
                          }`}
                        >
                          {money(d.ggr)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {d.uniquePlayers}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>

          <PanelCard className="p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Top players by bet volume
            </h3>
            {topPlayers.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                No player activity in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left">
                      <Th>Player</Th>
                      <Th className="text-right">Bets</Th>
                      <Th className="text-right">Bet amount</Th>
                      <Th className="text-right">Wins</Th>
                      <Th className="text-right">GGR</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPlayers.map((p) => (
                      <tr
                        key={p.userId}
                        className="border-b border-[var(--border)] last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">{p.name}</span>
                          {p.phone && (
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {p.phone}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.bets}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(p.betAmount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(p.winAmount)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            p.ggr >= 0 ? "text-green-600" : "text-[var(--danger)]"
                          }`}
                        >
                          {money(p.ggr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>
        </>
      )}
    </>
  );
}

function MasterSwitchPanel() {
  const status = useCasinoStatusQuery();
  const mutation = useUpdateCasinoStatusMutation();
  const [error, setError] = useState("");

  const enabled = status.data?.enabled;

  async function toggle() {
    setError("");
    try {
      await mutation.mutateAsync(!enabled);
    } catch (err) {
      setError(err?.message || "Failed to update casino status");
    }
  }

  return (
    <PanelCard className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Casino availability
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Master switch for the player <code>/casino</code> page. When turned
            off, players see a blank screen — this is independent of InOut and
            does not change the catalog below.
          </p>
          {error && (
            <p className="mt-1 text-xs font-medium text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {status.isLoading ? (
            <span className="text-xs text-[var(--muted)]">Loading…</span>
          ) : (
            <>
              <span
                className={`text-xs font-semibold ${
                  enabled ? "text-green-600" : "text-[var(--danger)]"
                }`}
              >
                {enabled ? "Casino is ON" : "Casino is OFF"}
              </span>
              <button
                type="button"
                onClick={toggle}
                disabled={mutation.isPending || status.isError}
                className={`relative inline-flex h-7 w-13 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
                style={{ width: "3.25rem" }}
                aria-label={enabled ? "Turn casino off" : "Turn casino on"}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    enabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </>
          )}
        </div>
      </div>
    </PanelCard>
  );
}

function GameRow({ game }) {
  const updateMutation = useUpdateCasinoGameMutation();
  const [orderDraft, setOrderDraft] = useState(String(game.sort_order ?? 0));
  const [rowError, setRowError] = useState("");

  const orderDirty = String(game.sort_order ?? 0) !== orderDraft.trim();

  async function toggleEnabled() {
    setRowError("");
    try {
      await updateMutation.mutateAsync({ id: game.id, enabled: !game.enabled });
    } catch (err) {
      setRowError(err?.message || "Failed to update");
    }
  }

  async function saveOrder() {
    setRowError("");
    const n = Number.parseInt(orderDraft, 10);
    if (!Number.isInteger(n)) {
      setRowError("Order must be a whole number");
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: game.id, sort_order: n });
    } catch (err) {
      setRowError(err?.message || "Failed to update");
    }
  }

  return (
    <tr className="border-b border-[var(--border)] last:border-b-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          {game.icon_url ? (
            <img
              src={game.icon_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded-sm object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded-sm bg-[var(--surfaceMuted)]" />
          )}
          <span className="font-semibold">{game.title}</span>
        </div>
        {rowError && (
          <p className="mt-1 text-[11px] font-medium text-[var(--danger)]">
            {rowError}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <code className="text-xs text-[var(--muted)]">{game.game_mode}</code>
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums">
        {game.rtp || "—"}
      </td>
      <td className="px-3 py-2.5 text-center text-xs text-[var(--muted)]">
        {game.multiplayer ? "Yes" : "No"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-center gap-1">
          <input
            type="number"
            value={orderDraft}
            onChange={(e) => setOrderDraft(e.target.value)}
            className="w-16 rounded-sm border border-[var(--border)] bg-[var(--bgApp)] px-2 py-1 text-center text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={saveOrder}
            disabled={!orderDirty || updateMutation.isPending}
            className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--surfaceMuted)] disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={updateMutation.isPending}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              game.enabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
            }`}
            aria-label={game.enabled ? "Disable game" : "Enable game"}
            title={game.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                game.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatCard({ label, value, accent }) {
  const valueColor =
    accent === "green"
      ? "text-green-600"
      : accent === "danger"
        ? "text-[var(--danger)]"
        : accent === "muted"
          ? "text-[var(--muted)]"
          : "text-[var(--text)]";
  return (
    <PanelCard className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </p>
    </PanelCard>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${className}`}
    >
      {children}
    </th>
  );
}
