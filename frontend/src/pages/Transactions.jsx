import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import { accountGhostBtn } from "../components/common/accountFormClasses";
import { topHeaderData, topNavItems } from "../data/homepageData";
import { fetchPlayerWalletHistory } from "../services/api";

const insetRow =
  "flex flex-col gap-1 rounded-2xl bg-(--sb-accent-surface-deep)/55 px-4 py-3  sm:flex-row sm:items-center sm:justify-between";

function formatTypeLabel(type) {
  if (!type) return "—";
  return String(type).replaceAll("_", " ");
}

function amountToneClass(type) {
  const t = String(type || "").toUpperCase();
  if (t === "DEPOSIT" || t === "PAYOUT" || t === "BONUS" || t === "CASHOUT") {
    return "text-(--sb-positive)";
  }
  if (t === "WITHDRAW" || t === "BET") return "text-[#ffb4a8]";
  return "text-[#ffffff]";
}

function Transactions() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);

  const load = useCallback(async (nextPage) => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPlayerWalletHistory({
        page: nextPage,
        limit: 20,
      });
      setPayload(data);
      setPage(data.page ?? nextPage);
    } catch (e) {
      if (e.message === "NOT_LOGGED_IN") {
        navigate("/login");
        return;
      }
      setError(e.message || "Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load(1);
  }, [load]);

  const totalPages = payload?.totalPages ?? 1;
  const items = payload?.items ?? [];

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-lg px-4 pb-28 pt-2 sm:px-5 sm:pt-4">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.14),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </button>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              Account
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Transaction history
            </h1>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-[rgba(255,255,255,0.72)]">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 animate-ping rounded-full bg-(--sb-accent-fill)/25" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-(--sb-bg-2) ring-2 ring-(--sb-accent-fill)/40">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#019052] border-t-(--sb-accent-fill)" />
              </div>
            </div>
            <span className="text-sm font-semibold">Loading…</span>
          </div>
        ) : error ? (
          <SoftPanel className="animate-deposit-panel ring-red-900/30">
            <p className="m-0 text-sm font-semibold text-[#ff6b6b]">{error}</p>
            <button
              type="button"
              onClick={() => load(page)}
              className="mt-4 w-full rounded-xl bg-(--sb-accent-surface-deep)/70 py-3 text-sm font-bold text-[#ffffff] "
            >
              Try again
            </button>
          </SoftPanel>
        ) : (
          <>
            <SoftPanel className="animate-deposit-panel mb-4">
              <p className="mb-1 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                Wallet activity
              </p>
              <p className="m-0 text-center text-[11px] text-[rgba(255,255,255,0.5)]">
                Deposits, withdrawals, bets, and bonuses posted to your balance.
              </p>
            </SoftPanel>

            {items.length === 0 ? (
              <SoftPanel className="animate-deposit-panel">
                <p className="m-0 text-center text-sm font-semibold text-[rgba(255,255,255,0.72)]">
                  No transactions yet.
                </p>
              </SoftPanel>
            ) : (
              <div className="flex flex-col gap-2.5">
                {items.map((tx) => {
                  const amt = Number(tx.amount ?? 0);
                  const created =
                    tx.createdAt != null
                      ? new Date(tx.createdAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";
                  const refText = tx.reference
                    ? String(tx.reference)
                    : "—";
                  return (
                    <div key={tx.id} className={insetRow}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-wide text-[rgba(255,255,255,0.72)]">
                            {formatTypeLabel(tx.type)}
                          </span>
                          <span className="text-[10px] text-[rgba(255,255,255,0.5)]">
                            {created}
                          </span>
                        </div>
                        <p
                          className="mt-1 truncate text-[11px] text-[rgba(255,255,255,0.5)]"
                          title={refText}
                        >
                          {refText}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`text-lg font-black tabular-nums ${amountToneClass(tx.type)}`}
                        >
                          {Number.isFinite(amt) ? `${amt.toLocaleString()} ETB` : "—"}
                        </p>
                        <p className="text-[10px] text-[rgba(255,255,255,0.5)]">
                          Bal{" "}
                          {tx.balanceAfter != null && Number.isFinite(Number(tx.balanceAfter))
                            ? Number(tx.balanceAfter).toLocaleString()
                            : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 ? (
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => load(page - 1)}
                  className={accountGhostBtn}
                >
                  Previous
                </button>
                <span className="flex-1 text-center text-xs font-bold text-[rgba(255,255,255,0.72)]">
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => load(page + 1)}
                  className={accountGhostBtn}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <MobileBottomBar
        selections={[]}
        onRemoveSelection={() => {}}
        onClearSelections={() => {}}
      />
      <div className="h-16 lg:hidden" />
    </PageContainer>
  );
}

export default Transactions;
