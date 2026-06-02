import { useMemo, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import { useBonusesQuery, useUpdateBonusMutation } from "../../hook/useSettingsQuery";

const DEFAULT_TIERS = [
  { minResult: "20", maxResult: "44", stakeMultiplier: "1" },
  { minResult: "45", maxResult: "79", stakeMultiplier: "2" },
  { minResult: "80", maxResult: "99", stakeMultiplier: "3" },
  { minResult: "100", maxResult: "199", stakeMultiplier: "4" },
  { minResult: "200", maxResult: "399", stakeMultiplier: "5" },
  { minResult: "400", maxResult: "", stakeMultiplier: "10" },
];

const MAX_TIERS = 10;

function listToText(list, fallback) {
  if (Array.isArray(list) && list.length > 0) return list.join(", ");
  return fallback;
}

function textToList(text) {
  return text
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function rowToForm(row) {
  const rules = row?.rules && typeof row.rules === "object" ? row.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  return {
    status: Boolean(row?.status),
    minSelections:
      rules.minSelections != null ? String(rules.minSelections) : "2",
    minStake: rules.minStake != null ? String(rules.minStake) : "10",
    maxHours: rules.maxHours != null ? String(rules.maxHours) : "72",
    minResult: rules.minResult != null ? String(rules.minResult) : "20",
    fixtureStatuses: listToText(
      rules.disqualifyFixtureStatuses,
      "PST, CANC, ABD",
    ),
    matchStatuses: listToText(rules.disqualifyMatchStatuses, "SUSPENDED"),
    tiers:
      tiers.length > 0
        ? tiers.map((t) => ({
            minResult: String(t.minResult ?? ""),
            maxResult: t.maxResult == null ? "" : String(t.maxResult),
            stakeMultiplier: String(t.stakeMultiplier ?? ""),
          }))
        : DEFAULT_TIERS.map((t) => ({ ...t })),
  };
}

export default function CashbackPanel() {
  const query = useBonusesQuery();
  const updateMut = useUpdateBonusMutation();
  const [form, setForm] = useState(null);
  const [syncedId, setSyncedId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const cashbackRow = useMemo(() => {
    const list = query.data?.items;
    if (!Array.isArray(list)) return null;
    return list.find((b) => b.type === "CASHBACK") ?? null;
  }, [query.data]);

  // Reset the editable form when the underlying cashback row changes
  // identity (initial load / different record). Setting state during
  // render with an id guard is React's recommended pattern and avoids
  // cascading renders from a setState-in-effect.
  if (cashbackRow && cashbackRow.id !== syncedId) {
    setSyncedId(cashbackRow.id);
    setForm(rowToForm(cashbackRow));
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setTier(idx, key, value) {
    setForm((f) => {
      const tiers = f.tiers.map((t, i) =>
        i === idx ? { ...t, [key]: value } : t,
      );
      return { ...f, tiers };
    });
  }

  function addTier() {
    setForm((f) =>
      f.tiers.length >= MAX_TIERS
        ? f
        : {
            ...f,
            tiers: [
              ...f.tiers,
              { minResult: "", maxResult: "", stakeMultiplier: "" },
            ],
          },
    );
  }

  function removeTier(idx) {
    setForm((f) => ({
      ...f,
      tiers: f.tiers.filter((_, i) => i !== idx),
    }));
  }

  function validateClient(tiers) {
    const parsed = tiers.map((t) => ({
      minResult: Number(t.minResult),
      maxResult: t.maxResult.trim() === "" ? null : Number(t.maxResult),
      stakeMultiplier: Number(t.stakeMultiplier),
    }));
    for (const t of parsed) {
      if (!Number.isFinite(t.minResult) || t.minResult < 0) {
        return "Each tier needs a min result >= 0.";
      }
      if (t.maxResult !== null && (!Number.isFinite(t.maxResult) || t.maxResult < t.minResult)) {
        return "Each tier max result must be blank or >= its min result.";
      }
      if (!Number.isFinite(t.stakeMultiplier) || t.stakeMultiplier < 0) {
        return "Each tier needs a stake multiplier >= 0.";
      }
    }
    parsed.sort((a, b) => a.minResult - b.minResult);
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].maxResult === null && i !== parsed.length - 1) {
        return "Only the last tier may have a blank (open-ended) max result.";
      }
      if (i > 0) {
        const prev = parsed[i - 1];
        if (prev.maxResult === null) return "Open-ended tier must be last.";
        if (parsed[i].minResult <= prev.maxResult) {
          return "Tier ranges must not overlap.";
        }
      }
    }
    return null;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!cashbackRow || !form) return;
    setError("");
    setSaved(false);

    const tierErr = validateClient(form.tiers);
    if (tierErr) {
      setError(tierErr);
      return;
    }

    const body = {
      status: form.status,
      minSelections: Number(form.minSelections),
      minStake: Number(form.minStake),
      maxHours: Number(form.maxHours),
      minResult: Number(form.minResult),
      disqualifyFixtureStatuses: textToList(form.fixtureStatuses),
      disqualifyMatchStatuses: textToList(form.matchStatuses),
      cashbackTiers: form.tiers.map((t) => ({
        minResult: Number(t.minResult),
        maxResult: t.maxResult.trim() === "" ? null : Number(t.maxResult),
        stakeMultiplier: Number(t.stakeMultiplier),
      })),
    };

    try {
      await updateMut.mutateAsync({ id: cashbackRow.id, body });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to save");
    }
  }

  if (query.isLoading) {
    return <p className="text-sm text-[var(--muted)]">Loading cashback…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-[var(--danger)]">
        {query.error?.message || "Failed to load"}
      </p>
    );
  }
  if (!cashbackRow) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--muted)]">
          No cashback program found. Run{" "}
          <code className="text-xs">npm run db:seed</code> in the backend folder
          to create the preset, then reload.
        </p>
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-[var(--accent)] underline"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          {query.isFetching ? "Loading…" : "Reload"}
        </button>
      </PanelCard>
    );
  }
  if (!form) return null;

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Cashback on losses
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        When a ticket loses, players get <strong>stake × multiplier</strong>{" "}
        back. The multiplier is chosen by{" "}
        <code className="text-xs">result = total odds ÷ lost-leg odds</code>.
        Example: 96 total odds, a lost leg at 2.3 → 96 ÷ 2.3 = 41.73 → the
        20–44 tier → 100% of stake (×1).
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-5">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.status}
            onChange={(e) => setField("status", e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)]"
          />
          <span className="text-sm font-semibold text-[var(--text)]">
            Active (turn cashback on)
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Min selections (more than)"
            hint="Cashback only if leg count is greater than this"
          >
            <input
              type="number"
              min="0"
              step="1"
              value={form.minSelections}
              onChange={(e) => setField("minSelections", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Min stake">
            <input
              type="number"
              min="0"
              step="any"
              value={form.minStake}
              onChange={(e) => setField("minStake", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Max hours (from placement)" hint="0 = no time limit">
            <input
              type="number"
              min="0"
              step="any"
              value={form.maxHours}
              onChange={(e) => setField("maxHours", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Min result (floor)" hint="Below this ratio, no payout">
            <input
              type="number"
              min="0"
              step="any"
              value={form.minResult}
              onChange={(e) => setField("minResult", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Disqualifying fixture statuses"
            hint="Any leg with these statuses voids cashback (system-managed)"
          >
            <div className={readOnlyClass}>{form.fixtureStatuses}</div>
          </Field>
          <Field
            label="Disqualifying match statuses"
            hint="Admin-managed match statuses that void cashback (system-managed)"
          >
            <div className={readOnlyClass}>{form.matchStatuses}</div>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Payout tiers (result range → stake multiplier)
            </span>
            {form.tiers.length < MAX_TIERS && (
              <button
                type="button"
                onClick={addTier}
                className="text-xs font-semibold text-[var(--accent)]"
              >
                + Add tier
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="text-[var(--muted)]">
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                    Min result
                  </th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                    Max result (blank = no cap)
                  </th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                    Stake ×
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {form.tiers.map((tier, idx) => (
                  <tr key={idx} className="align-middle">
                    <td className="py-1 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={tier.minResult}
                        onChange={(e) =>
                          setTier(idx, "minResult", e.target.value)
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={tier.maxResult}
                        onChange={(e) =>
                          setTier(idx, "maxResult", e.target.value)
                        }
                        placeholder="∞"
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={tier.stakeMultiplier}
                        onChange={(e) =>
                          setTier(idx, "stakeMultiplier", e.target.value)
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1">
                      {form.tiers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTier(idx)}
                          className="text-xs text-[var(--danger)]"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PrimaryButton type="submit" disabled={updateMut.isPending} className="w-auto">
          {updateMut.isPending ? "Saving…" : "Save cashback settings"}
        </PrimaryButton>

        {saved && (
          <p className="text-xs font-medium text-green-600">Saved successfully.</p>
        )}
        {error && (
          <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
        )}
      </form>
    </PanelCard>
  );
}

const inputClass =
  "w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";

const readOnlyClass =
  "w-full rounded-sm border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)] cursor-not-allowed select-none";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
