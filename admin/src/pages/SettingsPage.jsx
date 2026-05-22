import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import PrimaryButton from "../components/ui/PrimaryButton";
import OnlineDepositReceiversPanel from "../components/settings/OnlineDepositReceiversPanel";
import BonusesPanel from "../components/settings/BonusesPanel";
import {
  useCancelWindowQuery,
  useCashoutMarginQuery,
  useUpdateCancelWindowMutation,
  useUpdateCashoutMarginMutation,
  useBettingLimitsQuery,
  useUpdateBettingLimitsMutation,
  useWinningsTaxQuery,
  useUpdateWinningsTaxMutation,
} from "../hook/useSettingsQuery";

const TABS = [
  { key: "betting", label: "Betting & tickets" },
  { key: "limits", label: "Limits" },
  { key: "payments", label: "Payments" },
  { key: "bonuses", label: "Bonuses" },
];

const VALID_TAB = new Set(TABS.map((t) => t.key));

// ─── Human-readable labels for the 7 limit keys ─────────────────────────────
const LIMIT_FIELDS = [
  { key: "MIN_BET_AMOUNT", label: "Minimum bet amount" },
  { key: "MAX_BET_AMOUNT", label: "Maximum bet amount" },
  { key: "MAX_WINNING_AMOUNT", label: "Maximum winning amount" },
  { key: "MIN_DEPOSIT", label: "Minimum deposit" },
  { key: "MAX_DEPOSIT", label: "Maximum deposit" },
  { key: "MIN_WITHDRAW", label: "Minimum withdrawal" },
  { key: "MAX_WITHDRAW", label: "Maximum withdrawal" },
];

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(() =>
    tabFromUrl && VALID_TAB.has(tabFromUrl) ? tabFromUrl : "betting",
  );

  useEffect(() => {
    if (tabFromUrl && VALID_TAB.has(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  function selectTab(key) {
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Platform-wide configuration for tickets, limits, and payments.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => selectTab(tab.key)}
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

      {activeTab === "betting" && (
        <div className="space-y-6">
          <CancelWindowSection />
          <CashoutMarginSection />
          <WinningsTaxSection />
        </div>
      )}
      {activeTab === "limits" && (
        <div className="space-y-6">
          <BettingLimitsSection />
        </div>
      )}
      {activeTab === "payments" && (
        <div className="space-y-6">
          <OnlineDepositReceiversPanel />
        </div>
      )}
      {activeTab === "bonuses" && (
        <div className="space-y-6">
          <BonusesPanel />
        </div>
      )}
    </AdminShell>
  );
}

function WinningsTaxSection() {
  const query = useWinningsTaxQuery();
  const mutation = useUpdateWinningsTaxMutation();
  const [enabled, setEnabled] = useState(true);
  const [rateDecimal, setRateDecimal] = useState("0.15");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.data) {
      setEnabled(Boolean(query.data.enabled));
      setRateDecimal(
        query.data.rate != null ? String(query.data.rate) : "0.15",
      );
    }
  }, [query.data]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);
    const parsed = Number.parseFloat(rateDecimal);
    if (!Number.isFinite(parsed)) {
      setError("Enter a valid tax rate.");
      return;
    }
    const minR = query.data?.minRate ?? 0;
    const maxR = query.data?.maxRate ?? 0.95;
    if (parsed < minR || parsed > maxR) {
      setError(`Rate must be between ${minR} and ${maxR} (e.g. 0.15 = 15%).`);
      return;
    }
    try {
      await mutation.mutateAsync({ enabled, rate: parsed });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to update");
    }
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Winnings tax
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        When enabled, new tickets snapshot this rate. Tax applies to online win
        credits, cashier payouts on WON tickets, and cashout offers. Existing
        tickets keep their snapshot (off for tickets created before this
        feature).
      </p>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {query.error?.message || "Failed to load setting"}
        </p>
      ) : (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            <span className="text-sm font-semibold text-[var(--text)]">
              Apply winnings tax on new tickets
            </span>
          </label>

          <label className="flex w-full max-w-xs flex-col">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Rate (decimal, e.g. 0.15 = 15%)
            </span>
            <input
              type="number"
              min={query.data?.minRate ?? 0}
              max={query.data?.maxRate ?? 0.95}
              step="0.001"
              value={rateDecimal}
              onChange={(e) => setRateDecimal(e.target.value)}
              disabled={!enabled}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </label>

          <PrimaryButton
            type="submit"
            disabled={mutation.isPending}
            className="w-auto"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </PrimaryButton>
        </form>
      )}

      {!query.data?.configuredInDatabase && !query.isLoading && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Using defaults (enabled {String(query.data?.defaultEnabled ?? true)},
          rate {query.data?.defaultRate ?? 0.15}) until you save.
        </p>
      )}

      <Feedback saved={saved} error={error} />
    </PanelCard>
  );
}

function CashoutMarginSection() {
  const query = useCashoutMarginQuery();
  const mutation = useUpdateCashoutMarginMutation();
  const [margin, setMargin] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.data?.margin != null) {
      setMargin(String(query.data.margin));
    }
  }, [query.data]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await mutation.mutateAsync(Number(margin));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to update");
    }
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Cashout margin
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Cashout offer formula: stake x won odds product x margin. Lower margin
        means lower payout.
      </p>
      {query.isLoading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {query.error?.message || "Failed to load setting"}
        </p>
      ) : (
        <form onSubmit={handleSave} className="mt-4 flex w-full items-end gap-3">
          <label className="flex w-full flex-col">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Margin ({query.data?.minMargin ?? 0.1} - {query.data?.maxMargin ?? 0.9})
            </span>
            <input
              type="number"
              min={query.data?.minMargin ?? 0.1}
              max={query.data?.maxMargin ?? 0.9}
              step="0.001"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              required
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <PrimaryButton
            type="submit"
            disabled={mutation.isPending}
            className="w-auto"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </PrimaryButton>
        </form>
      )}

      {!query.data?.configuredInDatabase && !query.isLoading && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Using default ({query.data?.defaultMargin}) - no value saved yet.
        </p>
      )}

      <Feedback saved={saved} error={error} />
    </PanelCard>
  );
}

// ─── Ticket cancel window ────────────────────────────────────────────────────

function CancelWindowSection() {
  const query = useCancelWindowQuery();
  const mutation = useUpdateCancelWindowMutation();
  const [minutes, setMinutes] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.data?.minutes != null) {
      setMinutes(String(query.data.minutes));
    }
  }, [query.data]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await mutation.mutateAsync(Number(minutes));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to update");
    }
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Ticket cancellation window
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        How many minutes after creation a ticket can still be cancelled (max{" "}
        {query.data?.maxMinutes ?? "10 080"} min / 7 days).
      </p>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {query.error?.message || "Failed to load setting"}
        </p>
      ) : (
        <form
          onSubmit={handleSave}
          className="mt-4   flex w-full items-end gap-3"
        >
          <label className="flex flex-col  w-full   ">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Minutes
            </span>
            <input
              type="number"
              min="1"
              max={query.data?.maxMinutes ?? 10080}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <PrimaryButton
            type="submit"
            disabled={mutation.isPending}
            className="w-auto"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </PrimaryButton>
        </form>
      )}

      {!query.data?.configuredInDatabase && !query.isLoading && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Using default ({query.data?.defaultMinutes} min) — no value saved yet.
        </p>
      )}

      <Feedback saved={saved} error={error} />
    </PanelCard>
  );
}

// ─── Betting limits ──────────────────────────────────────────────────────────

function BettingLimitsSection() {
  const query = useBettingLimitsQuery();
  const mutation = useUpdateBettingLimitsMutation();
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.data) {
      const init = {};
      for (const { key } of LIMIT_FIELDS) {
        init[key] = query.data[key] != null ? String(query.data[key]) : "";
      }
      setValues(init);
    }
  }, [query.data]);

  function handleChange(key, val) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);

    const payload = {};
    for (const { key } of LIMIT_FIELDS) {
      const v = values[key];
      if (v !== "" && v != null) payload[key] = Number(v);
    }

    if (Object.keys(payload).length === 0) {
      setError("Enter at least one limit value.");
      return;
    }

    try {
      await mutation.mutateAsync(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to update");
    }
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Betting & financial limits
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Set minimum/maximum amounts for bets, deposits, and withdrawals. Leave a
        field empty to keep it unconfigured.
      </p>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {query.error?.message || "Failed to load limits"}
        </p>
      ) : (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LIMIT_FIELDS.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {label}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={values[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder="Not set"
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </label>
            ))}
          </div>

          <PrimaryButton
            type="submit"
            disabled={mutation.isPending}
            className="w-auto"
          >
            {mutation.isPending ? "Saving..." : "Save limits"}
          </PrimaryButton>
        </form>
      )}

      <Feedback saved={saved} error={error} />
    </PanelCard>
  );
}

// ─── Shared feedback toast ───────────────────────────────────────────────────

function Feedback({ saved, error }) {
  return (
    <>
      {saved && (
        <p className="mt-3 text-xs font-medium text-green-600">
          Saved successfully.
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs font-medium text-[var(--danger)]">{error}</p>
      )}
    </>
  );
}
