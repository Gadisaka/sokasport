import { useCallback, useEffect, useState } from "react";
import AppIcon from "../common/AppIcon";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../services/api";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function NotificationsDialog({ open, onClose, onReadChange }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchNotifications({ page: 1, limit: 50 });
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err.message || "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleItemClick(n) {
    if (!n.readAt) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) =>
          prev.map((row) =>
            row.id === n.id
              ? { ...row, readAt: new Date().toISOString() }
              : row,
          ),
        );
        onReadChange?.();
      } catch {
        /* ignore */
      }
    }
  }

  async function handleMarkAll() {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setItems((prev) =>
        prev.map((row) => ({
          ...row,
          readAt: row.readAt || new Date().toISOString(),
        })),
      );
      onReadChange?.();
    } catch {
      /* ignore */
    } finally {
      setMarkingAll(false);
    }
  }

  if (!open) return null;

  const hasUnread = items.some((n) => !n.readAt);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/55 p-4 pt-16 sm:pt-20"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-dialog-title"
        className="flex max-h-[min(80vh,560px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-transparent bg-(--sb-bg-page) shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <h2
            id="notifications-dialog-title"
            className="text-sm font-bold uppercase tracking-wide text-[#e8edf8]"
          >
            {t("notifications.title")}
          </h2>
          <div className="flex items-center gap-2">
            {hasUnread ? (
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                disabled={markingAll}
                className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[#7eb8ff] hover:text-white disabled:opacity-50"
              >
                {t("notifications.markAllRead")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-2) hover:text-white"
            >
              <AppIcon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-[rgba(255,255,255,0.72)]">
              {t("notifications.loading")}
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-[#f87171]">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-[rgba(255,255,255,0.72)]">
              {t("notifications.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((n) => {
                const unread = !n.readAt;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void handleItemClick(n)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                        unread
                          ? "border-transparent bg-(--sb-bg-2)"
                          : "border-transparent bg-(--sb-bg-page)"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-[#e8edf8]">
                          {n.title}
                        </span>
                        {unread ? (
                          <span className="shrink-0 rounded-full bg-[#3b82f6] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                            {t("notifications.new")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[rgba(255,255,255,0.72)]">
                        {n.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#6b7a99]">
                        {formatWhen(n.createdAt)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
