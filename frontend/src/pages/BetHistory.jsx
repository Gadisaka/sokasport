import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import SiteFooter from "../components/layout/SiteFooter";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import { topHeaderData, topNavItems } from "../data/homepageData";
import {
  executePlayerCashout,
  fetchBetHistory,
  fetchPlayerCashoutQuote,
  cancelPlayerTicket,
} from "../services/api";
import { usePlatformSettings } from "../hooks/usePlatformSettings";
import { playerOnlineCancelEligible } from "../utils/ticketCancelUi";
import { taxLabelForBetHistory } from "../utils/winningsTax";

const STATUS_STYLES = {
  pending: "bg-(--sb-accent-surface) text-[#019052]",
  won: "bg-[var(--sb-accent-surface)] text-(--sb-accent-soft)",
  lost: "bg-[#3a1515] text-[#ff6b6b]",
  cancelled: "bg-[#2a2a3e] text-[rgba(255,255,255,0.72)]",
};

/** Per-leg settlement: VOID uses dash; WON / LOST / PENDING show labels. */
function SelectionResultDot({ result }) {
  const r = String(result || "PENDING").toUpperCase();
  const pillSm =
    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[7px] font-extrabold leading-none";
  const pillLabel =
    "flex shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[8px] font-extrabold leading-none tracking-tight";

  if (r === "WON") {
    return (
      <span
        className={`${pillLabel} bg-[#15803d] text-white`}
        title="Won"
        aria-label="Leg won"
      >
        won
      </span>
    );
  }
  if (r === "LOST") {
    return (
      <span
        className={`${pillLabel} bg-[#b91c1c] text-white`}
        title="Lost"
        aria-label="Leg lost"
      >
        lost
      </span>
    );
  }
  if (r === "VOID") {
    return (
      <span
        className={`${pillSm} bg-[#475569] text-white`}
        title="Void"
        aria-label="Leg void"
      >
        −
      </span>
    );
  }
  return (
    <span
      className={`${pillLabel} bg-[#eab308] text-white`}
      title="Pending"
      aria-label="Leg pending"
    >
      pending
    </span>
  );
}

function formatDateTimeEnGB(iso) {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BetCard({
  bet,
  quote,
  quoteLoading,
  executeLoading,
  actionError,
  actionSuccess,
  onCheckQuote,
  onExecuteCashout,
  ticketCancelWindowMinutes,
  winningsTax,
  cancelBusy,
  cancelError,
  cancelSuccess,
  onCancelTicket,
}) {
  const [expanded, setExpanded] = useState(false);
  const canAttemptCashout =
    bet.rawStatus === "OPEN" || bet.rawStatus === "PRINTED";
  const cancelEligibleUi =
    ticketCancelWindowMinutes != null &&
    playerOnlineCancelEligible({
      rawStatus: bet.rawStatus,
      createdAt: bet.createdAt,
      selections: bet.selections,
      windowMinutes: ticketCancelWindowMinutes,
    });
  const date =
    formatDateTimeEnGB(bet.createdAt) ||
    new Date(bet.createdAt).toLocaleString("en-GB");

  return (
    <div className="animate-deposit-panel overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/92 via-(--sb-bg-2)/95 to-(--sb-bg-page)/92 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.5)] ">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-4 py-3.5 text-left transition-colors duration-200 hover:bg-(--sb-accent-surface-deep)/40"
      >
        <div className="flex items-center gap-3">
          <span
            className={`rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ring-1 ring-white/10 ${
              STATUS_STYLES[bet.status] || STATUS_STYLES.pending
            }`}
          >
            {bet.status}
          </span>
          <span className="text-xs text-[rgba(255,255,255,0.72)]">{date}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-[#ffffff]">
            {bet.stake} ETB
          </span>
          <AppIcon
            name={expanded ? "chevronUp" : "chevronDown"}
            size={14}
            className="text-[rgba(255,255,255,0.72)]"
          />
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          expanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="border-t border-white/8 bg-(--sb-accent-surface-deep)/25">
          {bet.selections.map((sel, i) => {
            const kickoffLabel = formatDateTimeEnGB(sel.matchStartTime);
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 border-b border-b-[#2a2f45]/80 px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-[#ffffff]">
                    {sel.matchName}
                  </div>
                  {kickoffLabel ? (
                    <div className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.5)]">
                      {kickoffLabel}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.72)]">
                    {sel.marketLabel}: {sel.label}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-sm font-extrabold leading-none text-(--sb-positive)">
                    {sel.odds}
                  </span>
                  <SelectionResultDot result={sel.result} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/8 px-4 py-4">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between rounded-xl bg-(--sb-accent-surface-deep)/35 px-3 py-2 ">
              <span className="text-xs text-[rgba(255,255,255,0.72)]">Stake</span>
              <span className="text-xs font-bold text-[#ffffff]">
                {bet.stake} ETB
              </span>
            </div>
            <div className="flex justify-between rounded-xl bg-(--sb-accent-surface-deep)/35 px-3 py-2 ">
              <span className="text-xs text-[rgba(255,255,255,0.72)]">Total Odds</span>
              <span className="text-xs font-bold text-[#ffffff]">
                {bet.totalOdds}
              </span>
            </div>
            {bet.tax > 0 &&
            bet.grossPotentialWin != null &&
            Number(bet.grossPotentialWin) !== Number(bet.netWin) ? (
              <div className="flex justify-between rounded-xl bg-(--sb-accent-surface-deep)/35 px-3 py-2 ">
                <span className="text-xs text-[rgba(255,255,255,0.72)]">Gross win</span>
                <span className="text-xs font-bold text-[#ffffff]">
                  {bet.grossPotentialWin} ETB
                </span>
              </div>
            ) : null}
            <div className="flex justify-between rounded-xl bg-(--sb-accent-surface-deep)/35 px-3 py-2 ">
              <span className="text-xs text-(--sb-accent-text-soft)">
                {taxLabelForBetHistory(bet, winningsTax)}
              </span>
              <span className="text-xs font-bold text-[#ffffff]">
                {bet.tax} ETB
              </span>
            </div>
            <div className="flex justify-between rounded-xl bg-(--sb-accent-surface)/25 px-3 py-2.5 ring-1 ring-(--sb-accent-fill)/20">
              <span className="text-sm font-bold text-[#ffffff]">
                Net payout
              </span>
              <span className="text-sm font-extrabold text-(--sb-accent-text-muted)">
                {bet.netWin} ETB
              </span>
            </div>
          </div>
          {expanded && cancelEligibleUi ? (
            <div className="mt-4 border-t border-white/8 pt-4">
              <button
                type="button"
                onClick={() => onCancelTicket(bet.id)}
                disabled={cancelBusy || quoteLoading || executeLoading}
                className="rounded-xl border border-[#5f3a3a] bg-[#2a1616] px-4 py-2 text-xs font-bold text-[#fecaca] transition-all duration-200 hover:ring-1 hover:ring-red-400/30 disabled:opacity-50"
              >
                {cancelBusy ? "Canceling..." : "Cancel bet"}
              </button>
              {cancelSuccess ? (
                <p className="mt-2 text-xs text-[#86efac]">{cancelSuccess}</p>
              ) : null}
              {cancelError ? (
                <p className="mt-2 text-xs text-[#ff6b6b]">{cancelError}</p>
              ) : null}
              <p className="mt-2 text-[10px] leading-snug text-[rgba(255,255,255,0.72)]">
                Only available before any match kicks off and within the
                cancellation window ({ticketCancelWindowMinutes} min).
              </p>
            </div>
          ) : null}
          {expanded && canAttemptCashout && (
            <div className="mt-4 border-t border-white/8 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCheckQuote(bet.id)}
                  disabled={quoteLoading || executeLoading}
                  className="rounded-xl bg-(--sb-accent-fill) px-4 py-2 text-xs font-bold text-white shadow-[0_8px_20px_-8px_rgba(1,144,82,0.45)] transition-all duration-200 hover:scale-[1.02] disabled:opacity-60"
                >
                  {quoteLoading ? "Checking..." : "Check Cash Out"}
                </button>
                <button
                  type="button"
                  onClick={() => onExecuteCashout(bet.id)}
                  disabled={!quote?.allowed || quoteLoading || executeLoading}
                  className="rounded-xl bg-[#7c3aed] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_20px_-8px_rgba(124,58,237,0.4)] transition-all duration-200 hover:scale-[1.02] disabled:opacity-40"
                >
                  {executeLoading ? "Processing..." : "Cash Out Now"}
                </button>
              </div>
              {quote && (
                <p className="mt-2 text-xs text-[rgba(255,255,255,0.72)]">
                  {quote.allowed
                    ? `Cash out offer: ${quote.amount} ETB (odds ${quote.breakdown?.currentOdds}, margin ${quote.breakdown?.margin}).`
                    : `Cash out unavailable (${quote.reasonCode || "not eligible"}).`}
                </p>
              )}
              {actionSuccess ? (
                <p className="mt-2 text-xs text-[#86efac]">{actionSuccess}</p>
              ) : null}
              {actionError ? (
                <p className="mt-2 text-xs text-[#ff6b6b]">{actionError}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BetHistory() {
  const navigate = useNavigate();
  const { ticketCancelWindowMinutes, winningsTax } = usePlatformSettings();
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quoteByTicket, setQuoteByTicket] = useState({});
  const [quoteLoadingId, setQuoteLoadingId] = useState("");
  const [executeLoadingId, setExecuteLoadingId] = useState("");
  const [actionErrorByTicket, setActionErrorByTicket] = useState({});
  const [actionSuccessByTicket, setActionSuccessByTicket] = useState({});
  const [cancelBusyId, setCancelBusyId] = useState("");
  const [cancelErrorByTicket, setCancelErrorByTicket] = useState({});
  const [cancelSuccessByTicket, setCancelSuccessByTicket] = useState({});

  const loadBetHistory = useCallback(() => {
    setLoading(true);
    fetchBetHistory()
      .then(setBets)
      .catch((err) => {
        if (err.message === "NOT_LOGGED_IN") {
          navigate("/login");
          return;
        }
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  useEffect(() => {
    loadBetHistory();
  }, [loadBetHistory]);

  async function handleCheckQuote(ticketId) {
    setQuoteLoadingId(ticketId);
    setActionErrorByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    setActionSuccessByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    try {
      const payload = await fetchPlayerCashoutQuote(ticketId);
      setQuoteByTicket((prev) => ({
        ...prev,
        [ticketId]: payload.quote || null,
      }));
    } catch (err) {
      if (err.message === "NOT_LOGGED_IN") {
        navigate("/login");
        return;
      }
      setActionErrorByTicket((prev) => ({
        ...prev,
        [ticketId]: err.message || "Failed to fetch cashout quote",
      }));
    } finally {
      setQuoteLoadingId("");
    }
  }

  async function handleExecuteCashout(ticketId) {
    setExecuteLoadingId(ticketId);
    setActionErrorByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    setActionSuccessByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    try {
      const payload = await executePlayerCashout(ticketId);
      setActionSuccessByTicket((prev) => ({
        ...prev,
        [ticketId]: payload.message || "Cash out completed.",
      }));
      setQuoteByTicket((prev) => ({
        ...prev,
        [ticketId]: payload.quote || null,
      }));
      loadBetHistory();
    } catch (err) {
      if (err.message === "NOT_LOGGED_IN") {
        navigate("/login");
        return;
      }
      setActionErrorByTicket((prev) => ({
        ...prev,
        [ticketId]: err.message || "Failed to cash out ticket",
      }));
    } finally {
      setExecuteLoadingId("");
    }
  }

  async function handleCancelTicket(ticketId) {
    setCancelBusyId(ticketId);
    setCancelErrorByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    setCancelSuccessByTicket((prev) => ({ ...prev, [ticketId]: "" }));
    try {
      await cancelPlayerTicket(ticketId);
      setCancelSuccessByTicket((prev) => ({
        ...prev,
        [ticketId]:
          "Ticket canceled. Funds were returned when you paid online.",
      }));
      window.dispatchEvent(new Event("balanceUpdated"));
      loadBetHistory();
    } catch (err) {
      if (err.message === "NOT_LOGGED_IN") {
        navigate("/login");
        return;
      }
      setCancelErrorByTicket((prev) => ({
        ...prev,
        [ticketId]: err.message || "Unable to cancel ticket",
      }));
    } finally {
      setCancelBusyId("");
    }
  }

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-lg px-4 pb-28 pt-2 sm:px-5 sm:pt-4">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.12),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </button>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              Your slips
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Bet history
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
            <span className="text-sm font-semibold">Loading bets…</span>
          </div>
        ) : error ? (
          <SoftPanel className="animate-deposit-panel ring-red-900/30">
            <p className="m-0 text-center text-sm font-semibold text-[#ff6b6b]">
              {error}
            </p>
          </SoftPanel>
        ) : bets.length === 0 ? (
          <SoftPanel className="animate-deposit-panel">
            <p className="m-0 text-center text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
              No bets placed yet. Go place your first bet!
            </p>
          </SoftPanel>
        ) : (
          <div className="flex flex-col gap-4">
            {bets.map((bet) => (
              <BetCard
                key={bet.id}
                bet={bet}
                quote={quoteByTicket[bet.id] || null}
                quoteLoading={quoteLoadingId === bet.id}
                executeLoading={executeLoadingId === bet.id}
                actionError={actionErrorByTicket[bet.id] || ""}
                actionSuccess={actionSuccessByTicket[bet.id] || ""}
                onCheckQuote={handleCheckQuote}
                onExecuteCashout={handleExecuteCashout}
                ticketCancelWindowMinutes={ticketCancelWindowMinutes}
                winningsTax={winningsTax}
                cancelBusy={cancelBusyId === bet.id}
                cancelError={cancelErrorByTicket[bet.id] || ""}
                cancelSuccess={cancelSuccessByTicket[bet.id] || ""}
                onCancelTicket={handleCancelTicket}
              />
            ))}
          </div>
        )}
      </div>

      {/* <SiteFooter /> */}
      <MobileBottomBar
        selections={[]}
        onRemoveSelection={() => {}}
        onClearSelections={() => {}}
      />
      <div className="h-16 lg:hidden" />
    </PageContainer>
  );
}

export default BetHistory;
