import { useEffect, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import { useUsersQuery } from "../../hook/useUsersQuery";
import { useSendAdminNotificationMutation } from "../../hook/useNotifications";

const AUDIENCE_OPTIONS = [
  { value: "all_cashiers", label: "All cashiers" },
  { value: "all_players", label: "All players" },
  { value: "specific_player", label: "Specific player" },
  { value: "specific_cashier", label: "Specific cashier" },
];

function formatUserLabel(u) {
  const phone = u.phone ? ` · ${u.phone}` : "";
  return `${u.name || u.email}${phone}`;
}

export default function CmsMessagesPanel({ canWrite }) {
  const [audience, setAudience] = useState("all_players");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sendMutation = useSendAdminNotificationMutation();

  const needsSpecific =
    audience === "specific_player" || audience === "specific_cashier";
  const roleFilter =
    audience === "specific_cashier"
      ? "CASHIER"
      : audience === "specific_player"
        ? "PLAYER"
        : "";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(userSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  const usersQuery = useUsersQuery({
    page: 1,
    search: debouncedSearch,
    role: roleFilter,
    enabled: needsSpecific,
  });

  const userItems = Array.isArray(usersQuery.data?.items)
    ? usersQuery.data.items
    : [];

  useEffect(() => {
    if (!needsSpecific) {
      setRecipientId("");
      setUserSearch("");
    }
  }, [audience, needsSpecific]);

  async function handleSend(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!canWrite) return;

    try {
      const result = await sendMutation.mutateAsync({
        audience,
        userId: needsSpecific ? recipientId : undefined,
        title: title.trim(),
        body: body.trim(),
      });
      setSuccess(
        `Message sent to ${result.recipientCount} recipient${result.recipientCount === 1 ? "" : "s"}.`,
      );
      setTitle("");
      setBody("");
      setRecipientId("");
      setUserSearch("");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(err.message || "Failed to send message");
    }
  }

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">Messages</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Send announcements to cashiers (ticket page inbox) or players (notification
        bell). System alerts for bets and wallet activity are sent automatically.
      </p>

      <form onSubmit={handleSend} className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Audience
          </span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            disabled={!canWrite}
            className="w-full max-w-md rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {AUDIENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {needsSpecific ? (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Search recipient
              </span>
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                disabled={!canWrite}
                placeholder="Name, phone, or email…"
                className="w-full max-w-md rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Recipient
              </span>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                disabled={!canWrite || usersQuery.isLoading}
                required
                className="w-full max-w-md rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="">Select…</option>
                {userItems.map((u) => (
                  <option key={u.id} value={u.id}>
                    {formatUserLabel(u)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canWrite}
            required
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            placeholder="Message title"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canWrite}
            required
            rows={6}
            className="w-full resize-y rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            placeholder="Write your message…"
          />
        </label>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {success ? (
          <p className="text-sm text-[var(--success,#22c55e)]">{success}</p>
        ) : null}

        <PrimaryButton
          type="submit"
          disabled={
            !canWrite ||
            sendMutation.isPending ||
            (needsSpecific && !recipientId)
          }
        >
          {sendMutation.isPending ? "Sending…" : "Send message"}
        </PrimaryButton>
      </form>
    </PanelCard>
  );
}
