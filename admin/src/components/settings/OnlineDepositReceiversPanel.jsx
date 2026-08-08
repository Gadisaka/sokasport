import { useEffect, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import {
  useOnlineDepositReceiversQuery,
  useUpdateOnlineDepositReceiversMutation,
} from "../../hook/useSettingsQuery";

const empty = {
  cbe: { receiverName: "", receiverAccount: "" },
  telebirr: { receiverName: "", receiverPhone: "" },
  cbebirr: { receiverName: "", receiverPhone: "", receiverAccount: "" },
};

/** Mirrors backend `isReceiverConfigured` — a channel without a target account is disabled. */
function unconfiguredChannels(receivers) {
  const missing = [];
  if (!receivers?.cbe?.receiverAccount) missing.push("CBE");
  if (!receivers?.telebirr?.receiverPhone) missing.push("Telebirr");
  if (!receivers?.cbebirr?.receiverPhone && !receivers?.cbebirr?.receiverAccount) {
    missing.push("CBE Birr");
  }
  return missing;
}

/**
 * Online deposit receiver config (CBE / Telebirr / CBE Birr). Used inside Settings tabs.
 */
export default function OnlineDepositReceiversPanel() {
  const query = useOnlineDepositReceiversQuery();
  const mutation = useUpdateOnlineDepositReceiversMutation();
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.data?.receivers) {
      setForm({
        cbe: { ...empty.cbe, ...query.data.receivers.cbe },
        telebirr: { ...empty.telebirr, ...query.data.receivers.telebirr },
        cbebirr: { ...empty.cbebirr, ...query.data.receivers.cbebirr },
      });
    }
  }, [query.data]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await mutation.mutateAsync(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to save");
    }
  }

  if (query.isLoading) {
    return <p className="text-sm text-[var(--muted)]">Loading...</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-[var(--danger)]">
        {query.error?.message || "Failed to load"}
      </p>
    );
  }

  const missing = unconfiguredChannels(query.data?.receivers);

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Account or phone and name shown to players for CBE, Telebirr, and CBE
        Birr. Deposits are only credited when the verification API confirms the
        payment reached these details, so a channel left blank stays disabled.
      </p>

      {missing.length ? (
        <div className="mb-4 rounded-sm border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]">
          Online deposits are disabled for {missing.join(", ")} until a receiving
          account is set.
        </div>
      ) : null}

      <form onSubmit={handleSave} className="space-y-6">
        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold">CBE</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Receiver name and account as shown on the CBE verification response.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver name
              </span>
              <input
                value={form.cbe.receiverName}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cbe: { ...f.cbe, receiverName: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver account
              </span>
              <input
                value={form.cbe.receiverAccount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cbe: { ...f.cbe, receiverAccount: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>
        </PanelCard>

        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold">Telebirr</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver name
              </span>
              <input
                value={form.telebirr.receiverName}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    telebirr: { ...f.telebirr, receiverName: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver phone (251…)
              </span>
              <input
                value={form.telebirr.receiverPhone}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    telebirr: { ...f.telebirr, receiverPhone: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>
        </PanelCard>

        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold">CBE Birr</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Set the wallet phone, and the bank account too if players also send
            from CBE Birr to your CBE account.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver name
              </span>
              <input
                value={form.cbebirr.receiverName}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cbebirr: { ...f.cbebirr, receiverName: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver phone (251…)
              </span>
              <input
                value={form.cbebirr.receiverPhone}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cbebirr: { ...f.cbebirr, receiverPhone: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold text-[var(--muted)]">
                Receiver bank account (optional)
              </span>
              <input
                value={form.cbebirr.receiverAccount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cbebirr: { ...f.cbebirr, receiverAccount: e.target.value },
                  }))
                }
                className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>
        </PanelCard>

        {error ? (
          <p className="text-sm text-[var(--danger)]">{error}</p>
        ) : null}
        {saved ? (
          <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Saved.
          </p>
        ) : null}

        <PrimaryButton type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save"}
        </PrimaryButton>
      </form>
    </div>
  );
}
