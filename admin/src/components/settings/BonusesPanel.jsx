import { useEffect, useMemo, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import Modal from "../ui/Modal";
import { useBonusesQuery, useUpdateBonusMutation } from "../../hook/useSettingsQuery";

const TYPE_ORDER = [
  "WELCOME",
  "FIRST_DEPOSIT",
  "DEPOSIT",
  "ACCUMULATOR",
  "CASHBACK",
  "REFERRAL",
];

const TYPE_HELP = {
  WELCOME:
    "Flat amount credited once when a player registers (uses fixed amount below, or percentage as fallback amount).",
  FIRST_DEPOSIT:
    "Percentage of the first deposit only (min deposit optional). On first credit, the larger of this and “Deposit bonus” applies.",
  DEPOSIT:
    "Percentage of every deposit after the first (min deposit optional).",
  ACCUMULATOR:
    "Extra % on possible win when the slip has enough legs. Add tiers: e.g. 11+ legs → 3%.",
  CASHBACK:
    "When a lost ticket meets minimum total odds, % of stake is returned to the wallet.",
  REFERRAL:
    "Reserved for future use. Toggling on has no effect until the feature is built.",
};

const emptyTier = { minLegs: "", bonusPercent: "" };

function bonusRowToForm(row) {
  const rules = row.rules && typeof row.rules === "object" ? row.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  return {
    percentage: row.percentage != null ? String(row.percentage) : "0",
    min_deposit:
      row.min_deposit != null ? String(row.min_deposit) : "",
    status: Boolean(row.status),
    welcomeFixedAmount:
      rules.fixedAmount != null ? String(rules.fixedAmount) : "",
    tiers:
      tiers.length > 0
        ? tiers.map((t) => ({
            minLegs: String(t.minLegs ?? ""),
            bonusPercent: String(t.bonusPercent ?? ""),
          }))
        : [{ ...emptyTier }],
    minTotalOdds:
      rules.minTotalOdds != null ? String(rules.minTotalOdds) : "1.5",
    percentOfStake:
      rules.percentOfStake != null ? String(rules.percentOfStake) : "0",
  };
}

export default function BonusesPanel() {
  const query = useBonusesQuery();
  const updateMut = useUpdateBonusMutation();
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const items = useMemo(() => {
    const list = query.data?.items;
    return Array.isArray(list) ? list : [];
  }, [query.data]);

  const apiReturnedNoBonuses = items.length === 0;

  const rows = useMemo(() => {
    return TYPE_ORDER.map((type) => ({
      type,
      row: items.find((b) => b.type === type) ?? null,
    }));
  }, [items]);

  const editingRow = editingId
    ? items.find((b) => b.id === editingId)
    : null;

  useEffect(() => {
    if (!editingRow) {
      setForm(null);
      return;
    }
    setForm(bonusRowToForm(editingRow));
  }, [editingRow]);

  function closeEdit() {
    setEditingId(null);
    setForm(null);
    setError("");
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!editingRow || !form) return;
    setError("");
    setSaved(false);
    const body = { status: form.status };
    const t = editingRow.type;

    try {
      if (t === "WELCOME") {
        body.percentage = Number(form.percentage);
        body.welcomeFixedAmount =
          form.welcomeFixedAmount.trim() === ""
            ? null
            : Number(form.welcomeFixedAmount);
      } else if (t === "FIRST_DEPOSIT" || t === "DEPOSIT") {
        body.percentage = Number(form.percentage);
        body.min_deposit =
          form.min_deposit.trim() === "" ? null : Number(form.min_deposit);
      } else if (t === "ACCUMULATOR") {
        body.percentage = Number(form.percentage);
        const tiers = form.tiers
          .filter(
            (x) =>
              String(x.minLegs).trim() !== "" ||
              String(x.bonusPercent).trim() !== "",
          )
          .map((x) => ({
            minLegs: Number.parseInt(x.minLegs, 10),
            bonusPercent: Number(x.bonusPercent),
          }));
        body.tiers = tiers;
      } else if (t === "CASHBACK") {
        body.minTotalOdds = Number(form.minTotalOdds);
        body.percentOfStake = Number(form.percentOfStake);
      } else if (t === "REFERRAL") {
        body.percentage = Number(form.percentage);
      }

      await updateMut.mutateAsync({ id: editingRow.id, body });
      setSaved(true);
      closeEdit();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to save");
    }
  }

  async function toggleStatus(row) {
    if (!row?.id) return;
    setError("");
    try {
      await updateMut.mutateAsync({
        id: row.id,
        body: { status: !row.status },
      });
    } catch (err) {
      setError(err.message || "Failed to toggle");
    }
  }

  function addTier() {
    if (!form || form.tiers.length >= 5) return;
    setForm((f) => ({
      ...f,
      tiers: [...f.tiers, { ...emptyTier }],
    }));
  }

  function removeTier(idx) {
    setForm((f) => ({
      ...f,
      tiers: f.tiers.filter((_, i) => i !== idx),
    }));
  }

  if (query.isLoading) {
    return <p className="text-sm text-[var(--muted)]">Loading bonuses…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-[var(--danger)]">
        {query.error?.message || "Failed to load"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        Bonuses are fixed slots (one per type). Enable or adjust amounts here.
        New environments: run{" "}
        <code className="text-xs">npm run db:seed</code> in the backend folder to
        create missing rows.
      </p>

      {apiReturnedNoBonuses && (
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--border)]/60 bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
          <span>
            The list is empty. If you already seeded the database, this tab may be
            showing a cached response (refresh on window focus is off globally).
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold text-[var(--accent)] underline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            {query.isFetching ? "Loading…" : "Reload list"}
          </button>
        </div>
      )}

      {saved && (
        <p className="text-xs font-medium text-green-600">Saved successfully.</p>
      )}
      {error && !editingId && (
        <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
      )}

      <PanelCard className="p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Bonus programs
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                <th className="pb-2 pr-3">Program</th>
                <th className="pb-2 pr-3">Active</th>
                <th className="pb-2 pr-3">Summary</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ type, row }) => (
                <tr
                  key={type}
                  className="border-b border-[var(--border)]/60 align-top"
                >
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-[var(--text)]">
                      {row?.name ?? type.replace(/_/g, " ")}
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {TYPE_HELP[type]}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    {row ? (row.status ? "Yes" : "No") : "—"}
                  </td>
                  <td className="py-3 pr-3 text-[var(--muted)]">
                    {!row ? (
                      apiReturnedNoBonuses ? (
                        "—"
                      ) : (
                        <span className="text-amber-600">
                          Missing — run db seed
                        </span>
                      )
                    ) : (
                      <BriefSummary row={row} />
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {row ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(row.id)}
                          className="text-xs font-semibold text-[var(--accent)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStatus(row)}
                          className="text-xs text-[var(--muted)]"
                          disabled={updateMut.isPending}
                        >
                          {row.status ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>

      <Modal
        open={Boolean(editingRow && form)}
        onClose={closeEdit}
        title={editingRow ? `Edit — ${editingRow.name}` : "Edit bonus"}
        centered
        maxWidthClassName="max-w-2xl"
      >
        {editingRow && form ? (
          <form onSubmit={handleSave} className="space-y-4">
            {error ? (
              <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.checked }))
                }
              />
              <span className="text-sm">Active (turn this program on)</span>
            </label>

            {editingRow.type === "WELCOME" && (
              <>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Welcome fixed amount (currency)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.welcomeFixedAmount}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        welcomeFixedAmount: e.target.value,
                      }))
                    }
                    placeholder="0 = use fallback below"
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Fallback flat amount (if fixed amount empty)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.percentage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, percentage: e.target.value }))
                    }
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
              </>
            )}

            {(editingRow.type === "FIRST_DEPOSIT" ||
              editingRow.type === "DEPOSIT") && (
              <>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Bonus % of deposit
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.percentage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, percentage: e.target.value }))
                    }
                    required
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Minimum deposit (optional)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.min_deposit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, min_deposit: e.target.value }))
                    }
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
              </>
            )}

            {editingRow.type === "ACCUMULATOR" && (
              <>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Fallback % (2+ legs if no tiers match)
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={form.percentage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, percentage: e.target.value }))
                    }
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Tiers (max 5): minimum legs → extra win %
                  </span>
                  <div className="space-y-2">
                    {form.tiers.map((tier, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <label className="flex flex-col">
                          <span className="text-[10px] text-[var(--muted)]">
                            Min legs
                          </span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={tier.minLegs}
                            onChange={(e) => {
                              const next = [...form.tiers];
                              next[idx] = {
                                ...next[idx],
                                minLegs: e.target.value,
                              };
                              setForm((f) => ({ ...f, tiers: next }));
                            }}
                            className="w-24 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-[10px] text-[var(--muted)]">
                            Extra %
                          </span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={tier.bonusPercent}
                            onChange={(e) => {
                              const next = [...form.tiers];
                              next[idx] = {
                                ...next[idx],
                                bonusPercent: e.target.value,
                              };
                              setForm((f) => ({ ...f, tiers: next }));
                            }}
                            className="w-24 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                          />
                        </label>
                        {form.tiers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTier(idx)}
                            className="text-xs text-[var(--danger)]"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {form.tiers.length < 5 && (
                    <button
                      type="button"
                      onClick={addTier}
                      className="mt-2 text-xs font-semibold text-[var(--accent)]"
                    >
                      + Add tier
                    </button>
                  )}
                </div>
              </>
            )}

            {editingRow.type === "CASHBACK" && (
              <>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Minimum ticket total odds
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={form.minTotalOdds}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, minTotalOdds: e.target.value }))
                    }
                    required
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block max-w-xs">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    % of stake returned on loss
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={form.percentOfStake}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        percentOfStake: e.target.value,
                      }))
                    }
                    required
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </label>
              </>
            )}

            {editingRow.type === "REFERRAL" && (
              <label className="block max-w-xs">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Placeholder % (not used yet)
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.percentage}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, percentage: e.target.value }))
                  }
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? "Saving…" : "Save"}
              </PrimaryButton>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

function BriefSummary({ row }) {
  const r = row.rules && typeof row.rules === "object" ? row.rules : {};
  switch (row.type) {
    case "WELCOME":
      return (
        <span>
          Fixed: {r.fixedAmount ?? "—"} · fallback: {row.percentage ?? 0}
        </span>
      );
    case "FIRST_DEPOSIT":
    case "DEPOSIT":
      return (
        <span>
          {row.percentage ?? 0}% · min dep {row.min_deposit ?? 0}
        </span>
      );
    case "ACCUMULATOR": {
      const tiers = Array.isArray(r.tiers) ? r.tiers : [];
      return (
        <span>
          {tiers.length} tier(s) · fallback {row.percentage ?? 0}%
        </span>
      );
    }
    case "CASHBACK":
      return (
        <span>
          min odds {r.minTotalOdds ?? "—"} · {r.percentOfStake ?? 0}% stake
        </span>
      );
    case "REFERRAL":
      return <span>{row.percentage ?? 0}% (reserved)</span>;
    default:
      return "—";
  }
}
