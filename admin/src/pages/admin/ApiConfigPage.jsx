import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import {
  useBookmakerPreferenceQuery,
  useBookmakerSamplesQuery,
  useBookmakersQuery,
  useRefreshOddsNowMutation,
  useSyncBookmakersMutation,
  useUpdateBookmakerPreferenceMutation,
} from "../../hook/useApiConfigQuery";

// Product policy update: "All bookmakers" aggregation is no longer
// supported. The admin must pick a single bookmaker; the backend uses
// that selection to filter odds writes (see backend/Config/oddsFilters.js).
//
// We still tolerate `null` on the backend (it represents "no preference
// configured yet") so existing data and unmigrated environments don't
// break. The UI surfaces a warning until a bookmaker is picked.

function formatKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatOdd(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(2);
}

export default function ApiConfigPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("preference");

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">API Configuration</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick which bookmaker’s odds are served to the public frontend.
          Switching takes effect on the next page refresh — cached fixtures
          and odds are automatically busted.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        <TabButton
          isActive={activeTab === "preference"}
          onClick={() => setActiveTab("preference")}
        >
          Preferred Bookmaker
        </TabButton>
        <TabButton
          isActive={activeTab === "samples"}
          onClick={() => setActiveTab("samples")}
        >
          Samples & Fetch
        </TabButton>
      </div>

      <div className="space-y-6">
        {activeTab === "preference" ? (
          <BookmakerPreferenceSection />
        ) : (
          <SamplesAndFetchSection />
        )}
      </div>
    </AdminShell>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function BookmakerPreferenceSection() {
  const bookmakers = useBookmakersQuery();
  const preference = useBookmakerPreferenceQuery();
  const mutation = useUpdateBookmakerPreferenceMutation();
  const syncMutation = useSyncBookmakersMutation();

  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");

  async function handleSyncBookmakers() {
    setSyncMessage("");
    setSyncError("");
    try {
      const result = await syncMutation.mutateAsync();
      const summary = `Synced ${result?.fetched ?? 0} bookmakers (${result?.created ?? 0} new, ${result?.updated ?? 0} updated).`;
      setSyncMessage(summary);
      setTimeout(() => setSyncMessage(""), 4000);
    } catch (err) {
      setSyncError(err?.message || "Failed to sync bookmakers from upstream");
    }
  }

  const currentPreferenceValue = preference.data?.apiBookmakerId ?? null;
  // Default the radio selection to whatever the admin currently has saved.
  // When nothing is saved yet, we leave it unselected (no default) so the
  // admin is forced to make an explicit choice under the new policy.
  const selectedValue = draft ?? currentPreferenceValue;

  const isDirty =
    draft !== null && draft !== currentPreferenceValue;

  const bookmakerList = bookmakers.data?.bookmakers ?? [];
  async function handleSave() {
    setError("");
    setSaved(false);

    if (selectedValue == null) {
      setError("Please select a bookmaker before saving.");
      return;
    }

    try {
      await mutation.mutateAsync(Number(selectedValue));
      setSaved(true);
      setDraft(null);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to update preference");
    }
  }

  if (bookmakers.isLoading || preference.isLoading) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--muted)]">Loading bookmakers…</p>
      </PanelCard>
    );
  }

  if (bookmakers.isError) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--danger)]">
          {bookmakers.error?.message || "Failed to load bookmakers"}
        </p>
      </PanelCard>
    );
  }

  if (!bookmakerList.length) {
    return (
      <PanelCard className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide">
              No bookmakers available yet
            </h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Pull the full upstream catalog (API-Sports{" "}
              <code>/odds/bookmakers</code>) so you can pick a provider before
              any odds have been ingested. This costs one upstream call and
              the list is cached for 24 hours.
            </p>
          </div>
          <PrimaryButton
            type="button"
            onClick={handleSyncBookmakers}
            disabled={syncMutation.isPending}
            className="w-auto shrink-0"
          >
            {syncMutation.isPending ? "Syncing…" : "Sync from upstream"}
          </PrimaryButton>
        </div>
        {(syncMessage || syncError) && (
          <div className="mt-3">
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
      </PanelCard>
    );
  }

  return (
    <PanelCard className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Preferred bookmaker
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Pick exactly one bookmaker. The backend will only fetch and
            persist odds from this provider — the legacy “all bookmakers”
            aggregation has been retired to reduce database load.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleSyncBookmakers}
            disabled={syncMutation.isPending}
            className="rounded-sm border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surfaceMuted)] disabled:opacity-50"
          >
            {syncMutation.isPending
              ? "Syncing…"
              : "Sync bookmakers from upstream"}
          </button>
          <PrimaryButton
            type="button"
            onClick={handleSave}
            disabled={!isDirty || mutation.isPending}
            className="w-auto"
          >
            {mutation.isPending ? "Saving…" : "Save preference"}
          </PrimaryButton>
        </div>
      </div>

      {(syncMessage || syncError) && (
        <div className="mt-3">
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

      {currentPreferenceValue === null && (
        <div className="mt-4 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <strong className="font-semibold">No bookmaker selected.</strong>{" "}
          Odds writes currently fall back to the
          {" "}<code>DEFAULT_BOOKMAKER_API_ID</code> environment variable
          (or, if unset, persist every bookmaker — legacy behaviour). Pick a
          bookmaker below to switch the system to single-bookmaker mode.
        </div>
      )}

      {(error || saved) && (
        <div className="mt-3">
          {saved && (
            <p className="text-xs font-medium text-green-600">
              Preference saved. Public caches were cleared — new odds appear on
              the next request.
            </p>
          )}
          {error && (
            <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {bookmakerList.map((bk) => {
          const value = String(bk.apiBookmakerId);
          const isSelected = selectedValue === bk.apiBookmakerId;
          const isCurrent = currentPreferenceValue === bk.apiBookmakerId;
          return (
            <label
              key={bk.id}
              className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 transition-colors ${
                isSelected
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] hover:bg-[var(--surfaceMuted)]"
              }`}
            >
              <input
                type="radio"
                name="preferred-bookmaker"
                value={value}
                checked={isSelected}
                onChange={() => setDraft(bk.apiBookmakerId)}
                className="h-4 w-4"
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-semibold">{bk.name}</div>
                <div className="text-xs text-[var(--muted)]">
                  {bk.oddLineCount.toLocaleString()} odd lines ingested
                </div>
              </div>
              {isCurrent && (
                <span className="shrink-0 rounded-sm bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600">
                  Current
                </span>
              )}
            </label>
          );
        })}
      </div>
    </PanelCard>
  );
}

function SamplesAndFetchSection() {
  const samples = useBookmakerSamplesQuery(3);
  const preference = useBookmakerPreferenceQuery();
  const refreshMutation = useRefreshOddsNowMutation();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const currentPreferenceValue = preference.data?.apiBookmakerId ?? null;

  const sampleList = useMemo(
    () => samples.data?.samples ?? [],
    [samples.data?.samples],
  );

  const bookmakersInSamples = useMemo(() => {
    const map = new Map();
    for (const sample of sampleList) {
      for (const bk of sample.bookmakers || []) {
        if (!map.has(bk.apiBookmakerId)) {
          map.set(bk.apiBookmakerId, {
            apiBookmakerId: bk.apiBookmakerId,
            name: bk.name,
            marketCountTotal: 0,
            oneXTwoBySample: new Map(),
          });
        }
        const entry = map.get(bk.apiBookmakerId);
        entry.marketCountTotal += bk.marketCount;
        entry.oneXTwoBySample.set(sample.apiFixtureId, bk.oneXTwo);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.marketCountTotal - a.marketCountTotal,
    );
  }, [sampleList]);

  async function handleFetchNow() {
    setMessage("");
    setError("");
    try {
      const result = await refreshMutation.mutateAsync();
      setMessage(result?.message || "Manual odds refresh completed.");
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setError(err?.message || "Manual odds refresh failed");
    }
  }

  return (
    <>
      <PanelCard className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide">
              On-demand fetch
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Fetch the latest odds now instead of waiting for the scheduled
              sync. This also refreshes API config data after completion.
            </p>
          </div>
          <PrimaryButton
            type="button"
            onClick={handleFetchNow}
            disabled={refreshMutation.isPending}
            className="w-auto shrink-0"
          >
            {refreshMutation.isPending ? "Fetching…" : "Fetch latest odds now"}
          </PrimaryButton>
        </div>
        {(message || error) && (
          <div className="mt-3">
            {message && (
              <p className="text-xs font-medium text-green-600">{message}</p>
            )}
            {error && (
              <p className="text-xs font-medium text-[var(--danger)]">
                {error}
              </p>
            )}
          </div>
        )}
      </PanelCard>

      <SampleGamesTable
        samples={sampleList}
        bookmakersInSamples={bookmakersInSamples}
        isLoading={samples.isLoading}
        isError={samples.isError}
        errorMessage={samples.error?.message}
        selectedValue={currentPreferenceValue}
        onSelect={() => {}}
        currentPreferenceValue={currentPreferenceValue}
        allowSelection={false}
      />
    </>
  );
}

function TabButton({ isActive, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm border px-3 py-2 text-sm font-semibold transition-colors ${
        isActive
          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
          : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surfaceMuted)]"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Sample games comparison table ───────────────────────────────────────────

function SampleGamesTable({
  samples,
  bookmakersInSamples,
  isLoading,
  isError,
  errorMessage,
  selectedValue,
  onSelect,
  currentPreferenceValue,
  allowSelection = true,
}) {
  if (isLoading) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--muted)]">Loading sample games…</p>
      </PanelCard>
    );
  }

  if (isError) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--danger)]">
          {errorMessage || "Failed to load samples"}
        </p>
      </PanelCard>
    );
  }

  if (!samples.length) {
    return (
      <PanelCard className="p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          No sample fixtures yet
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Sample games appear once the next 48 hours contain at least one
          fixture with ingested odds. Kick off the odds sync, then refresh.
        </p>
      </PanelCard>
    );
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Compare bookmakers across {samples.length} sample game
        {samples.length === 1 ? "" : "s"}
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Each row is one bookmaker. The columns show that bookmaker’s{" "}
        <span className="font-semibold">1 / X / 2</span> prices for the next
        few upcoming fixtures, plus the total number of markets it priced.
        Use this to decide which feed has the best coverage.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Bookmaker
              </th>
              <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Markets
              </th>
              {samples.map((sample) => (
                <th
                  key={sample.apiFixtureId}
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                >
                  <div className="font-semibold text-[var(--text)]">
                    {sample.homeTeam} vs {sample.awayTeam}
                  </div>
                  <div className="mt-0.5 text-[10px] font-normal normal-case text-[var(--muted)]">
                    {sample.league.country} · {sample.league.name} ·{" "}
                    {formatKickoff(sample.startTime)}
                  </div>
                </th>
              ))}
              {allowSelection && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {bookmakersInSamples.map((bk) => {
              const isSelected = selectedValue === bk.apiBookmakerId;
              const isCurrent = currentPreferenceValue === bk.apiBookmakerId;
              return (
                <tr
                  key={bk.apiBookmakerId}
                  className={`border-b border-[var(--border)] last:border-b-0 ${
                    isSelected ? "bg-[var(--accent)]/5" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{bk.name}</span>
                      {isCurrent && (
                        <span className="rounded-sm bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600">
                          Current
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-semibold text-[var(--muted)]">
                    {bk.marketCountTotal}
                  </td>
                  {samples.map((sample) => {
                    const oneXTwo = bk.oneXTwoBySample.get(sample.apiFixtureId);
                    return (
                      <td
                        key={`${bk.apiBookmakerId}-${sample.apiFixtureId}`}
                        className="px-3 py-2"
                      >
                        {oneXTwo ? (
                          <div className="flex items-center gap-1">
                            <OddsPill label="1" value={oneXTwo["1"]} />
                            <OddsPill label="X" value={oneXTwo["X"]} />
                            <OddsPill label="2" value={oneXTwo["2"]} />
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                    );
                  })}
                  {allowSelection && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onSelect(bk.apiBookmakerId)}
                        className={`rounded-sm border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          isSelected
                            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                            : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surfaceMuted)]"
                        }`}
                      >
                        {isSelected ? "Selected" : "Pick this book"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PanelCard>
  );
}

function OddsPill({ label, value }) {
  return (
    <div className="flex min-w-[48px] items-center gap-1 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-1.5 py-1">
      <span className="text-[10px] font-bold text-[var(--muted)]">{label}</span>
      <span className="text-xs font-semibold tabular-nums">
        {formatOdd(value)}
      </span>
    </div>
  );
}
