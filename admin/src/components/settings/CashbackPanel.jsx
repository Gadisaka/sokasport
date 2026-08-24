import { useMemo, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import { useBonusesQuery, useUpdateBonusMutation } from "../../hook/useSettingsQuery";

const ONE_LOSS_TIERS = [
  { minResult: "19", maxResult: "39", stakeMultiplier: "1" },
  { minResult: "40", maxResult: "59", stakeMultiplier: "2" },
  { minResult: "60", maxResult: "89", stakeMultiplier: "3" },
  { minResult: "90", maxResult: "250", stakeMultiplier: "5" },
  { minResult: "251", maxResult: "499", stakeMultiplier: "10" },
  { minResult: "500", maxResult: "999", stakeMultiplier: "20" },
  { minResult: "1000", maxResult: "1999", stakeMultiplier: "30" },
  { minResult: "2000", maxResult: "2999", stakeMultiplier: "50" },
  { minResult: "3000", maxResult: "", stakeMultiplier: "100" },
];

const TWO_LOSS_TIERS = [
  { minResult: "20", maxResult: "45", stakeMultiplier: "1" },
  { minResult: "46", maxResult: "59", stakeMultiplier: "2" },
  { minResult: "61", maxResult: "89", stakeMultiplier: "3" },
  { minResult: "90", maxResult: "450", stakeMultiplier: "6" },
  { minResult: "451", maxResult: "999", stakeMultiplier: "12" },
  { minResult: "1000", maxResult: "1799", stakeMultiplier: "21" },
  { minResult: "1800", maxResult: "", stakeMultiplier: "50" },
];

const DEFAULT_PROFILES = [
  {
    key: "oneLoss",
    lostLegs: "1",
    minLegs: "5",
    minLegOdds: "1.01",
    minStakeOnline: "10",
    minStakeOffline: "20",
    minResult: "19",
    tiers: ONE_LOSS_TIERS.map((t) => ({ ...t })),
  },
  {
    key: "twoLoss",
    lostLegs: "2",
    minLegs: "10",
    minLegOdds: "1.40",
    minStakeOnline: "20",
    minStakeOffline: "20",
    minResult: "20",
    tiers: TWO_LOSS_TIERS.map((t) => ({ ...t })),
  },
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

function cloneTiers(tiers, fallback) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return fallback.map((t) => ({ ...t }));
  }
  return tiers.map((t) => ({
    minResult: String(t.minResult ?? ""),
    maxResult: t.maxResult == null ? "" : String(t.maxResult),
    stakeMultiplier: String(t.stakeMultiplier ?? ""),
  }));
}

function findProfile(profiles, lostLegs, key) {
  if (!Array.isArray(profiles)) return null;
  return (
    profiles.find((p) => Number(p.lostLegs) === lostLegs) ??
    profiles.find((p) => p.key === key) ??
    null
  );
}

function profileToForm(raw, defaults) {
  if (!raw) return { ...defaults, tiers: defaults.tiers.map((t) => ({ ...t })) };
  return {
    key: raw.key || defaults.key,
    lostLegs: raw.lostLegs != null ? String(raw.lostLegs) : defaults.lostLegs,
    minLegs: raw.minLegs != null ? String(raw.minLegs) : defaults.minLegs,
    minLegOdds:
      raw.minLegOdds != null ? String(raw.minLegOdds) : defaults.minLegOdds,
    minStakeOnline:
      raw.minStakeOnline != null
        ? String(raw.minStakeOnline)
        : defaults.minStakeOnline,
    minStakeOffline:
      raw.minStakeOffline != null
        ? String(raw.minStakeOffline)
        : defaults.minStakeOffline,
    minResult:
      raw.minResult != null ? String(raw.minResult) : defaults.minResult,
    tiers: cloneTiers(raw.tiers, defaults.tiers),
  };
}

function rowToForm(row) {
  const rules = row?.rules && typeof row.rules === "object" ? row.rules : {};
  const profiles = Array.isArray(rules.profiles) ? rules.profiles : [];
  return {
    status: Boolean(row?.status),
    maxHours: rules.maxHours != null ? String(rules.maxHours) : "48",
    excludeLiveForOnline: rules.excludeLiveForOnline !== false,
    fixtureStatuses: listToText(
      rules.disqualifyFixtureStatuses,
      "PST, CANC, ABD",
    ),
    matchStatuses: listToText(rules.disqualifyMatchStatuses, "SUSPENDED"),
    profiles: [
      profileToForm(findProfile(profiles, 1, "oneLoss"), DEFAULT_PROFILES[0]),
      profileToForm(findProfile(profiles, 2, "twoLoss"), DEFAULT_PROFILES[1]),
    ],
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

  if (cashbackRow && cashbackRow.id !== syncedId) {
    setSyncedId(cashbackRow.id);
    setForm(rowToForm(cashbackRow));
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setProfile(idx, key, value) {
    setForm((f) => {
      const profiles = f.profiles.map((p, i) =>
        i === idx ? { ...p, [key]: value } : p,
      );
      return { ...f, profiles };
    });
  }

  function setTier(profileIdx, tierIdx, key, value) {
    setForm((f) => {
      const profiles = f.profiles.map((p, i) => {
        if (i !== profileIdx) return p;
        const tiers = p.tiers.map((t, j) =>
          j === tierIdx ? { ...t, [key]: value } : t,
        );
        return { ...p, tiers };
      });
      return { ...f, profiles };
    });
  }

  function addTier(profileIdx) {
    setForm((f) => {
      const profiles = f.profiles.map((p, i) => {
        if (i !== profileIdx || p.tiers.length >= MAX_TIERS) return p;
        return {
          ...p,
          tiers: [
            ...p.tiers,
            { minResult: "", maxResult: "", stakeMultiplier: "" },
          ],
        };
      });
      return { ...f, profiles };
    });
  }

  function removeTier(profileIdx, tierIdx) {
    setForm((f) => {
      const profiles = f.profiles.map((p, i) =>
        i === profileIdx
          ? { ...p, tiers: p.tiers.filter((_, j) => j !== tierIdx) }
          : p,
      );
      return { ...f, profiles };
    });
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

  function parseProfile(p) {
    return {
      key: p.key,
      lostLegs: Number(p.lostLegs),
      minLegs: Number(p.minLegs),
      minLegOdds: Number(p.minLegOdds),
      minStakeOnline: Number(p.minStakeOnline),
      minStakeOffline: Number(p.minStakeOffline),
      minResult: Number(p.minResult),
      tiers: p.tiers.map((t) => ({
        minResult: Number(t.minResult),
        maxResult: t.maxResult.trim() === "" ? null : Number(t.maxResult),
        stakeMultiplier: Number(t.stakeMultiplier),
      })),
    };
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!cashbackRow || !form) return;
    setError("");
    setSaved(false);

    for (const p of form.profiles) {
      if (!Number.isInteger(Number(p.minLegs)) || Number(p.minLegs) < 1) {
        setError("Each profile needs min legs of at least 1.");
        return;
      }
      if (!Number.isFinite(Number(p.minLegOdds)) || Number(p.minLegOdds) < 1) {
        setError("Each profile needs a min leg odds of at least 1.");
        return;
      }
      const tierErr = validateClient(p.tiers);
      if (tierErr) {
        setError(`${p.key === "twoLoss" ? "2-loss" : "1-loss"}: ${tierErr}`);
        return;
      }
    }

    const body = {
      status: form.status,
      maxHours: Number(form.maxHours),
      excludeLiveForOnline: form.excludeLiveForOnline,
      disqualifyFixtureStatuses: textToList(form.fixtureStatuses),
      disqualifyMatchStatuses: textToList(form.matchStatuses),
      cashbackProfiles: form.profiles.map(parseProfile),
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
        <code className="text-xs">
          result = total odds ÷ sum of lost-leg odds
        </code>
        . Two tracks: 1 lost leg (5+ bets) and 2 lost legs (10+ bets). Example:
        96 total odds, one lost leg at 2.3 → 96 ÷ 2.3 = 41.74 → 1-loss 40–59
        band → ×2.
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <label className="flex cursor-pointer items-center gap-3 self-end pb-1">
            <input
              type="checkbox"
              checked={form.excludeLiveForOnline}
              onChange={(e) => setField("excludeLiveForOnline", e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            <span className="text-sm text-[var(--text)]">
              Exclude live bets for online users
            </span>
          </label>
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

        {form.profiles.map((profile, idx) => (
          <ProfileSection
            key={profile.key}
            title={profile.key === "twoLoss" ? "2 losses" : "1 loss"}
            profile={profile}
            onField={(key, value) => setProfile(idx, key, value)}
            onTier={(tierIdx, key, value) => setTier(idx, tierIdx, key, value)}
            onAddTier={() => addTier(idx)}
            onRemoveTier={(tierIdx) => removeTier(idx, tierIdx)}
          />
        ))}

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

function ProfileSection({
  title,
  profile,
  onField,
  onTier,
  onAddTier,
  onRemoveTier,
}) {
  return (
    <fieldset className="rounded-sm border border-[var(--border)] p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Min legs (at least)" hint="Cashback if the slip has this many bets or more">
          <input
            type="number"
            min="1"
            step="1"
            value={profile.minLegs}
            onChange={(e) => onField("minLegs", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Min leg odds (greater than)" hint="Every bet on the ticket must be strictly above this">
          <input
            type="number"
            min="1"
            step="any"
            value={profile.minLegOdds}
            onChange={(e) => onField("minLegOdds", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Min result (floor)" hint="Below this ratio, no payout">
          <input
            type="number"
            min="0"
            step="any"
            value={profile.minResult}
            onChange={(e) => onField("minResult", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Min stake (online)">
          <input
            type="number"
            min="0"
            step="any"
            value={profile.minStakeOnline}
            onChange={(e) => onField("minStakeOnline", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Min stake (cashier / offline)">
          <input
            type="number"
            min="0"
            step="any"
            value={profile.minStakeOffline}
            onChange={(e) => onField("minStakeOffline", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Payout tiers (result range → stake multiplier)
          </span>
          {profile.tiers.length < MAX_TIERS && (
            <button
              type="button"
              onClick={onAddTier}
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
              {profile.tiers.map((tier, idx) => (
                <tr key={idx} className="align-middle">
                  <td className="py-1 pr-3">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={tier.minResult}
                      onChange={(e) => onTier(idx, "minResult", e.target.value)}
                      className={inputClass}
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={tier.maxResult}
                      onChange={(e) => onTier(idx, "maxResult", e.target.value)}
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
                        onTier(idx, "stakeMultiplier", e.target.value)
                      }
                      className={inputClass}
                    />
                  </td>
                  <td className="py-1">
                    {profile.tiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveTier(idx)}
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
    </fieldset>
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
