import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import AppIcon from "../common/AppIcon";
import CouponReceipt from "../common/CouponReceipt";
import {
  fetchPublicCouponTicket,
  hasAuthToken,
  placeBet,
} from "../../services/api";
import {
  isSelectionExpired,
  slipHasExpiredSelection,
} from "../../utils/selectionExpiry";
import {
  clampStakeToUpperBound,
  parseStakeNumeric,
  capGrossPotentialWin,
  stakeAndPotentialWinViolation,
  stakeBoundsInvalid,
  stakeLimitsHintParts,
} from "../../utils/stakeLimits";
import { mapCouponSelectionsToSlipRows } from "../../utils/couponTicketToSlip";
import { formatCouponInput } from "../../utils/formatCouponInput";
import { slipGrossTaxNet, winningsTaxLabel } from "../../utils/winningsTax";
import { useActiveBonuses } from "../../hooks/useActiveBonuses";
import {
  accumulatorBonusExtraGrossFormatted,
  accumulatorPercentFromBonusesList,
} from "../../utils/accumulatorBonus";
import { useOddsSocket } from "../../hooks/useOddsSocket";
import {
  MAX_SLIP_SELECTIONS,
  clampSelectionsToMax,
  slipLegCountViolation,
} from "../../utils/betSlipLimits";
import {
  formatOddsChangeParts,
  oddsDirection,
} from "../../utils/oddsDirection";

const modalBackdrop =
  "fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm";

const modalPanel =
  "relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/96 via-(--sb-bg-2)/98 to-(--sb-bg-page)/96 px-5 pb-5 pt-10 text-[#ffffff]  shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

const modalPanelMd =
  "relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/96 via-(--sb-bg-2)/98 to-(--sb-bg-page)/96 text-[#ffffff]  shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

function ModalClose({ onClick, label = "Close" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/60 text-lg text-[rgba(255,255,255,0.72)] transition-all hover:bg-(--sb-bg-2) hover:ring-1 hover:ring-(--sb-accent-fill)/25"
      aria-label={label}
    >
      ✕
    </button>
  );
}

const slipDivider = "border-white/8";

function computePlacementSnapshot(
  selections,
  stakeNum,
  { limits, winningsTax, activeBonuses, lockedByFixture },
) {
  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some(
    (sel) =>
      String(sel.marketState || "").toUpperCase() === "LOCKED" ||
      Boolean(lockedByFixture[Number(sel.apiFixtureId)]),
  );
  const totalOddsProduct =
    selections.length && !hasExpiredSelection && !hasLockedSelection
      ? selections.reduce((acc, s) => acc * parseFloat(s.value), 1)
      : null;
  const totalOdds =
    selections.length === 0
      ? "0.00"
      : hasExpiredSelection || hasLockedSelection
        ? "—"
        : totalOddsProduct != null && Number.isFinite(totalOddsProduct)
          ? totalOddsProduct.toFixed(2)
          : "0.00";
  const accPct = accumulatorPercentFromBonusesList(
    activeBonuses,
    selections.length,
  );
  const rawGrossPotentialWin =
    totalOddsProduct != null && Number.isFinite(totalOddsProduct)
      ? stakeNum * totalOddsProduct * (1 + accPct / 100)
      : null;
  const cappedGrossPotentialWin =
    rawGrossPotentialWin != null
      ? capGrossPotentialWin(limits, rawGrossPotentialWin)
      : null;
  const possibleWin =
    cappedGrossPotentialWin != null ? cappedGrossPotentialWin.toFixed(2) : "—";
  const { netWin } = slipGrossTaxNet(possibleWin, winningsTax);
  return {
    selections: [...selections],
    stake: stakeNum,
    totalOdds,
    maxWin: possibleWin,
    netPay: netWin,
  };
}

function MobileBetSlip({
  open,
  onClose,
  selections,
  onRemoveSelection,
  onClearSelections,
  onReplaceSelections = () => {},
  stakeInput,
  onStakeInputChange,
  limits = null,
  winningsTax = null,
  slipLimitNotice = null,
  onDismissSlipLimitNotice = () => {},
}) {
  const stakeNum = parseStakeNumeric(stakeInput) ?? 0;
  const [placing, setPlacing] = useState(false);
  const [betResult, setBetResult] = useState(null);
  const [placedBet, setPlacedBet] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [copiedCoupon, setCopiedCoupon] = useState(false);
  const [loadCouponInput, setLoadCouponInput] = useState("");
  const [checkCouponInput, setCheckCouponInput] = useState("");
  const [couponLoadingLoad, setCouponLoadingLoad] = useState(false);
  const [couponLoadingCheck, setCouponLoadingCheck] = useState(false);
  const [couponCheckPreview, setCouponCheckPreview] = useState(null);
  const [lockedByFixture, setLockedByFixture] = useState({});
  const isMulti = selections.length > 1;
  const [, setTick] = useState(0);
  const { bonuses: activeBonuses } = useActiveBonuses();

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const socketFixtureIds = selections
    .map((s) => Number(s.apiFixtureId))
    .filter((id) => Number.isFinite(id));
  useOddsSocket(socketFixtureIds, {
    onLocked: (payload) => {
      const id = Number(payload?.apiFixtureId);
      if (!Number.isFinite(id)) return;
      setLockedByFixture((prev) => ({ ...prev, [id]: true }));
    },
    onUnlocked: (payload) => {
      const id = Number(payload?.apiFixtureId);
      if (!Number.isFinite(id)) return;
      setLockedByFixture((prev) => ({ ...prev, [id]: false }));
    },
  });

  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some(
    (sel) =>
      String(sel.marketState || "").toUpperCase() === "LOCKED" ||
      Boolean(lockedByFixture[Number(sel.apiFixtureId)]),
  );
  const totalOddsProduct =
    selections.length && !hasExpiredSelection && !hasLockedSelection
      ? selections.reduce((acc, s) => acc * parseFloat(s.value), 1)
      : null;
  const totalOdds =
    selections.length === 0
      ? "0.00"
      : hasExpiredSelection || hasLockedSelection
        ? "—"
        : totalOddsProduct != null && Number.isFinite(totalOddsProduct)
          ? totalOddsProduct.toFixed(2)
          : "0.00";

  const accPct = accumulatorPercentFromBonusesList(
    activeBonuses,
    selections.length,
  );
  const accBonusExtraEtb =
    accPct > 0 &&
    totalOddsProduct != null &&
    Number.isFinite(totalOddsProduct) &&
    !hasExpiredSelection
      ? accumulatorBonusExtraGrossFormatted(stakeNum, totalOddsProduct, accPct)
      : null;

  const rawGrossPotentialWin =
    totalOddsProduct != null && Number.isFinite(totalOddsProduct)
      ? stakeNum * totalOddsProduct * (1 + accPct / 100)
      : null;
  const cappedGrossPotentialWin =
    rawGrossPotentialWin != null
      ? capGrossPotentialWin(limits, rawGrossPotentialWin)
      : null;
  const possibleWin =
    cappedGrossPotentialWin != null ? cappedGrossPotentialWin.toFixed(2) : "—";
  const { tax, netWin } = slipGrossTaxNet(possibleWin, winningsTax);

  const stakeHintParts = stakeLimitsHintParts(limits);
  const stakeViolation =
    selections.length &&
    !hasExpiredSelection &&
    totalOddsProduct != null &&
    Number.isFinite(totalOddsProduct) &&
    cappedGrossPotentialWin != null
      ? stakeAndPotentialWinViolation(limits, stakeNum, cappedGrossPotentialWin)
      : null;

  const stakeFieldInvalid = stakeBoundsInvalid(limits, stakeInput);
  const selectionCount = selections.length;
  const atMaxSelections = selectionCount >= MAX_SLIP_SELECTIONS;
  const legViolation = slipLegCountViolation(selectionCount);

  async function handlePlaceBet() {
    if (legViolation || placing) return;
    if (slipHasExpiredSelection(selections)) {
      setBetResult({
        type: "error",
        message:
          "One or more matches are expired. Remove them before placing your bet.",
      });
      setTimeout(() => setBetResult(null), 4500);
      return;
    }

    const winCheck =
      totalOddsProduct != null && Number.isFinite(totalOddsProduct)
        ? stakeAndPotentialWinViolation(
            limits,
            stakeNum,
            capGrossPotentialWin(
              limits,
              stakeNum * totalOddsProduct * (1 + accPct / 100),
            ),
          )
        : null;
    if (winCheck) {
      setBetResult({
        type: "error",
        message: winCheck,
      });
      setTimeout(() => setBetResult(null), 4500);
      return;
    }

    setPlacing(true);
    setBetResult(null);

    const snapshotCtx = {
      limits,
      winningsTax,
      activeBonuses,
      lockedByFixture,
    };
    const snap = computePlacementSnapshot(selections, stakeNum, snapshotCtx);

    try {
      const data = await placeBet(selections, stakeNum, {
        acceptOddsChanges: false,
        idempotencyKey,
      });
      setIdempotencyKey(data?.idempotencyKey || null);
      setCopiedCoupon(false);
      setPlacedBet({
        couponNumber: data.couponNumber || data.coupon_number || "",
        receiptNumber: data.receiptNumber ?? data.receipt_number ?? "",
        paidWithWallet: hasAuthToken(),
        ...snap,
      });
      window.dispatchEvent(new Event("balanceUpdated"));
    } catch (err) {
      const driftCodes = new Set(["odds_changed", "market_version_changed"]);
      if (driftCodes.has(String(err?.code || "")) && err?.details) {
        const changed = Array.isArray(err.details.selections)
          ? err.details.selections
          : [];
        const hasInvalidServerOdds = changed.some((row) => {
          const n = Number(row?.serverOdds);
          return !Number.isFinite(n) || n <= 1;
        });
        const hasLiveSelection = selections.some((sel) =>
          Boolean(sel?.fromLive),
        );
        if (hasInvalidServerOdds && !hasLiveSelection) {
          setBetResult({
            type: "error",
            message:
              "One or more markets are temporarily unavailable. Please try again in a moment.",
          });
          setTimeout(() => setBetResult(null), 4500);
          return;
        }
        const updatedSelections = selections.map((sel, idx) => {
          const row = changed.find((entry) => Number(entry.index) === idx);
          if (!row || !Number.isFinite(Number(row.serverOdds))) return sel;
          const previousOdds = Number(sel.acceptedOdds ?? sel.value);
          const newOdds = Number(row.serverOdds);
          return {
            ...sel,
            previousOdds: Number.isFinite(previousOdds) ? previousOdds : null,
            oddsDirection: oddsDirection(previousOdds, newOdds),
            acceptedOdds: newOdds,
            acceptedMarketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketState: row.marketState || sel.marketState || "OPEN",
            value: newOdds.toFixed(2),
          };
        });
        const idem = err?.idempotencyKey || idempotencyKey;
        setIdempotencyKey(idem);
        const freezeToken = err.details.freezeToken ?? null;
        try {
          const retry = await placeBet(updatedSelections, stakeNum, {
            acceptOddsChanges: true,
            freezeToken,
            idempotencyKey: idem,
          });
          const snapRetry = computePlacementSnapshot(
            updatedSelections,
            stakeNum,
            snapshotCtx,
          );
          setIdempotencyKey(retry?.idempotencyKey || idem || null);
          setCopiedCoupon(false);
          setPlacedBet({
            couponNumber: retry.couponNumber || retry.coupon_number || "",
            receiptNumber: retry.receiptNumber ?? retry.receipt_number ?? "",
            paidWithWallet: hasAuthToken(),
            ...snapRetry,
            usedLatestOdds: true,
          });
          window.dispatchEvent(new Event("balanceUpdated"));
        } catch (retryErr) {
          setBetResult({
            type: "error",
            message:
              retryErr?.code === "market_locked"
                ? "Market is locked. Try again in a few seconds."
                : retryErr.message,
          });
          setTimeout(() => setBetResult(null), 4000);
        }
        return;
      }
      setBetResult({
        type: "error",
        message:
          err?.code === "market_locked"
            ? "Market is locked. Try again in a few seconds."
            : err.message,
      });
      setTimeout(() => setBetResult(null), 4000);
    } finally {
      setPlacing(false);
    }
  }

  async function handleCopyCoupon() {
    if (placedBet?.paidWithWallet || !placedBet?.couponNumber) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(placedBet.couponNumber);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = placedBet.couponNumber;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopiedCoupon(true);
      setTimeout(() => setCopiedCoupon(false), 1500);
    } catch {
      setBetResult({
        type: "error",
        message: "Could not copy coupon number. Please copy manually.",
      });
      setTimeout(() => setBetResult(null), 2500);
    }
  }

  async function handleLoadCouponSubmit() {
    const trimmed = String(loadCouponInput || "")
      .trim()
      .toLowerCase();
    if (!trimmed || couponLoadingLoad) return;
    setCouponLoadingLoad(true);
    setBetResult(null);
    try {
      const data = await fetchPublicCouponTicket(trimmed);
      const rows = mapCouponSelectionsToSlipRows(
        data.couponNumber ?? trimmed,
        data.selections ?? [],
      );
      if (!rows.length) {
        setBetResult({
          type: "error",
          message: "This ticket has no selections to load.",
        });
        setTimeout(() => setBetResult(null), 4000);
        return;
      }
      const clamped = clampSelectionsToMax(rows);
      if (clamped.length < rows.length) {
        setBetResult({
          type: "error",
          message: `This coupon has more than ${MAX_SLIP_SELECTIONS} matches. Only the first ${MAX_SLIP_SELECTIONS} were loaded.`,
        });
        setTimeout(() => setBetResult(null), 5000);
      }
      onReplaceSelections(clamped);
      setBetResult({
        type: "success",
        message: "Coupon template loaded onto this slip.",
      });
      setTimeout(() => setBetResult(null), 3500);
    } catch (err) {
      setBetResult({
        type: "error",
        message: err?.message || "Could not load coupon.",
      });
      setTimeout(() => setBetResult(null), 4000);
    } finally {
      setCouponLoadingLoad(false);
    }
  }

  async function handleCheckCouponSubmit() {
    const trimmed = String(checkCouponInput || "")
      .trim()
      .toLowerCase();
    if (!trimmed || couponLoadingCheck) return;
    setCouponLoadingCheck(true);
    setBetResult(null);
    try {
      const data = await fetchPublicCouponTicket(trimmed);
      setCouponCheckPreview(data);
    } catch (err) {
      setBetResult({
        type: "error",
        message: err?.message || "Ticket not found.",
      });
      setTimeout(() => setBetResult(null), 4500);
    } finally {
      setCouponLoadingCheck(false);
    }
  }

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 z-60 flex flex-col rounded-t-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/96 via-(--sb-accent-surface-deep)/96 to-(--sb-bg-page)/95 shadow-[0_-12px_40px_-8px_rgba(0,0,0,0.55)]  backdrop-blur-md transition-transform duration-300 ease-in-out lg:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ height: "100vh", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {/* Tabs header */}
        <div
          className={`flex shrink-0 items-center border-b bg-(--sb-accent-surface-deep)/35 backdrop-blur-md ${slipDivider}`}
        >
          <button
            type="button"
            className={`mx-0.5 flex-1 cursor-pointer rounded-t-xl border-0 bg-transparent py-3 text-sm font-bold transition-colors ${
              isMulti
                ? "text-(--sb-accent-text-on-dark) shadow-[inset_0_-2px_0_0_var(--sb-accent-fill)]"
                : "text-[rgba(255,255,255,0.72)]"
            }`}
          >
            Multi
          </button>
          <button
            type="button"
            className={`mx-0.5 flex-1 cursor-pointer rounded-t-xl border-0 bg-transparent py-3 text-sm font-bold transition-colors ${
              !isMulti
                ? "text-(--sb-accent-text-on-dark) shadow-[inset_0_-2px_0_0_var(--sb-accent-fill)]"
                : "text-[rgba(255,255,255,0.72)]"
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-[rgba(255,255,255,0.72)] transition-colors hover:bg-(--sb-accent-surface-deep)/50 hover:text-[#ffffff]"
          >
            <AppIcon name="chevronDown" size={20} />
          </button>
        </div>

        <div
          className={`space-y-2 border-b bg-(--sb-accent-surface-deep)/25 px-3 pb-2.5 pt-2 backdrop-blur-sm shrink-0 ${slipDivider}`}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={loadCouponInput}
              onChange={(e) =>
                setLoadCouponInput(formatCouponInput(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLoadCouponSubmit();
              }}
              placeholder="Load Coupon..."
              disabled={couponLoadingLoad}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 px-3 text-[13px] text-[#ffffff] shadow-inner shadow-black/25 ring-1 ring-white/10 outline-none transition-all placeholder:text-[rgba(255,255,255,0.72)] focus:ring-2 focus:ring-(--sb-accent-fill)/45 disabled:opacity-60"
            />
            <button
              type="button"
              title="Load coupon into bet slip"
              disabled={couponLoadingLoad}
              onClick={handleLoadCouponSubmit}
              className="flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 text-[#9aaed1] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/35 disabled:pointer-events-none disabled:opacity-50"
            >
              {couponLoadingLoad ? (
                <span className="text-[10px] font-bold text-[rgba(255,255,255,0.72)]">…</span>
              ) : (
                <AppIcon name="clipboard" size={17} strokeWidth={1.9} />
              )}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={checkCouponInput}
              onChange={(e) =>
                setCheckCouponInput(formatCouponInput(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCheckCouponSubmit();
              }}
              placeholder="Check Coupon..."
              disabled={couponLoadingCheck}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 px-3 text-[13px] text-[#ffffff] shadow-inner shadow-black/25 ring-1 ring-white/10 outline-none transition-all placeholder:text-[rgba(255,255,255,0.72)] focus:ring-2 focus:ring-(--sb-accent-fill)/45 disabled:opacity-60"
            />
            <button
              type="button"
              title="Check coupon status"
              disabled={couponLoadingCheck}
              onClick={handleCheckCouponSubmit}
              className="flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 text-[#9aaed1] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/35 disabled:pointer-events-none disabled:opacity-50"
            >
              {couponLoadingCheck ? (
                <span className="text-[10px] font-bold text-[rgba(255,255,255,0.72)]">…</span>
              ) : (
                <AppIcon name="ticket" size={17} strokeWidth={1.9} />
              )}
            </button>
          </div>
        </div>

        {slipLimitNotice ? (
          <div
            className={`shrink-0 border-b px-3 py-2 text-center text-xs font-semibold text-[#fecaca] ring-1 ring-red-900/25 ${slipDivider} bg-[#3a1515]/90`}
          >
            <span>{slipLimitNotice}</span>
            <button
              type="button"
              onClick={onDismissSlipLimitNotice}
              className="ml-2 cursor-pointer border-0 bg-transparent text-[10px] font-bold uppercase tracking-wide text-[#fca5a5] underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {selectionCount > 0 ? (
          <div
            className={`shrink-0 flex items-center justify-between border-b px-4 py-1.5 text-[11px] font-semibold ${slipDivider} ${
              atMaxSelections
                ? "bg-[#3a2a10]/80 text-[#fcd34d]"
                : "bg-(--sb-accent-surface-deep)/15 text-[rgba(255,255,255,0.72)]"
            }`}
          >
            <span>
              {selectionCount} / {MAX_SLIP_SELECTIONS} matches
            </span>
            {atMaxSelections ? <span>Maximum reached</span> : null}
          </div>
        ) : null}

        {/* Selections list */}
        <div className="flex-1 overflow-y-auto">
          {selections.map((sel) => {
            const expired = isSelectionExpired(sel);
            return (
              <div
                key={sel.id}
                className={`flex items-center justify-between border-b px-4 py-3 transition-colors ${slipDivider} ${
                  expired ? "bg-[#2a1515]/55" : "active:bg-(--sb-accent-surface-deep)/20"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div
                      className={`text-sm font-bold ${
                        expired
                          ? "text-[#f87171] line-through decoration-[#f87171]/80"
                          : "text-[#ffffff]"
                      }`}
                    >
                      {sel.matchName}
                    </div>
                    {expired ? (
                      <span className="rounded bg-[#450a0a] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#fecaca]">
                        Expired
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={`mt-0.5 text-xs ${
                      expired ? "text-[#f87171]/90" : "text-[rgba(255,255,255,0.72)]"
                    }`}
                  >
                    {sel.marketLabel}: {sel.label}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-extrabold ${
                      expired
                        ? "text-[#f87171]"
                        : "text-(--sb-accent-text-muted)"
                    }`}
                  >
                    {sel.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveSelection(sel.id)}
                    className="cursor-pointer border-0 bg-transparent text-[rgba(255,255,255,0.72)] hover:text-[#ff6b6b]"
                  >
                    <AppIcon name="x" size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom: stake input + stats + place bet */}
        <div
          className={`shrink-0 border-t bg-(--sb-accent-surface-deep)/30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm ${slipDivider}`}
        >
          {betResult && (
            <div
              className={`mb-3 rounded px-3 py-2 text-center text-xs font-bold ${
                betResult.type === "success"
                  ? "bg-(--sb-accent-surface) text-(--sb-accent-text-on-dark)"
                  : "bg-[#3a1515] text-[#ff6b6b]"
              }`}
            >
              {betResult.message}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              value={stakeInput}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  onStakeInputChange("");
                  return;
                }
                const n = Number(v);
                if (!Number.isFinite(n)) return;
                onStakeInputChange(String(clampStakeToUpperBound(limits, n)));
              }}
              className={`h-11 min-w-0 flex-1 rounded-2xl border-0 bg-(--sb-accent-surface-deep)/80 px-3 text-sm font-bold shadow-inner shadow-black/25 ring-1 outline-none transition-all focus:ring-2 ${
                stakeFieldInvalid
                  ? "text-[#fecaca] ring-[#b91c1c]/55 focus:ring-red-500/35"
                  : "text-[#ffffff] ring-white/10 focus:ring-(--sb-accent-fill)/45"
              }`}
            />
            <button
              type="button"
              disabled={
                limits?.MAX_BET_AMOUNT == null ||
                !Number.isFinite(limits.MAX_BET_AMOUNT)
              }
              title="Sets stake to configured maximum bet"
              onClick={() =>
                limits?.MAX_BET_AMOUNT != null &&
                Number.isFinite(limits.MAX_BET_AMOUNT) &&
                onStakeInputChange(String(limits.MAX_BET_AMOUNT))
              }
              className="h-11 shrink-0 cursor-pointer rounded-2xl border-0 bg-(--sb-accent-fill) px-4 text-xs font-extrabold text-white shadow-[0_8px_20px_-6px_rgba(1,144,82,0.4)] transition-all hover:bg-(--sb-accent-fill-hover) disabled:cursor-not-allowed disabled:opacity-40"
            >
              MAX
            </button>
          </div>
          {stakeHintParts.length > 0 ? (
            <p className="mb-1 text-[10px] leading-snug text-[#6e7ea3]">
              {stakeHintParts.join(" · ")}
            </p>
          ) : null}
          {stakeViolation ? (
            <p className="mb-3 text-[11px] font-semibold leading-snug text-[#ff8a8a]">
              {stakeViolation}
            </p>
          ) : null}

          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-[rgba(255,255,255,0.72)]">Total Odds</span>
              <span className="font-bold text-(--sb-accent-text-muted)">
                {totalOdds}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[rgba(255,255,255,0.72)]">
                {winningsTaxLabel(winningsTax)}
              </span>
              <span className="font-bold text-[#ffffff]">
                {tax === "—" ? "—" : `${tax} ETB`}
              </span>
            </div>
            {accPct > 0 &&
            selections.length > 0 &&
            !hasExpiredSelection &&
            accBonusExtraEtb != null ? (
              <div className="col-span-2 flex justify-between gap-2">
                <span className="text-[rgba(255,255,255,0.72)]">Accumulator bonus</span>
                <span className="flex flex-col items-end font-bold text-[#86efac]">
                  <span>
                    +
                    {Number.isInteger(accPct)
                      ? accPct
                      : Number.parseFloat(Number(accPct).toFixed(2))}
                    %
                  </span>
                  <span className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#a7f3d0]">
                    +{accBonusExtraEtb} ETB
                  </span>
                </span>
              </div>
            ) : null}
            <div className="col-span-2 flex justify-between">
              <span className="font-bold text-(--sb-accent-text-muted)">
                Net win / payout
              </span>
              <span className="font-bold text-(--sb-accent-text-muted)">
                {netWin === "—" ? "—" : `${netWin} ETB`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearSelections}
              className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-0 bg-(--sb-accent-surface-deep)/80 text-[rgba(255,255,255,0.72)] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/25"
            >
              <AppIcon name="trash" size={18} />
            </button>
            <button
              type="button"
              disabled={
                placing ||
                Boolean(legViolation) ||
                hasExpiredSelection ||
                hasLockedSelection ||
                Boolean(stakeViolation)
              }
              onClick={handlePlaceBet}
              className="h-12 min-w-0 flex-1 cursor-pointer rounded-2xl border-0 bg-(--sb-accent-fill) text-base font-extrabold tracking-wide text-white shadow-[0_12px_28px_-8px_rgba(1,144,82,0.45)] transition-all hover:bg-(--sb-accent-fill-hover) hover:shadow-[0_16px_32px_-8px_rgba(1,144,82,0.52)] disabled:pointer-events-none disabled:opacity-50"
            >
              {placing ? "PLACING..." : "PLACE BET"}
            </button>
          </div>
        </div>
      </div>
      {couponCheckPreview &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483646 }}>
            <div className={modalPanel}>
              <ModalClose
                onClick={() => setCouponCheckPreview(null)}
                label="Close ticket preview"
              />
              <div className="flex justify-center">
                <CouponReceipt ticket={couponCheckPreview} />
              </div>
            </div>
          </div>,
          document.body,
        )}
      {placedBet &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483647 }}>
            <div className={`${modalPanelMd} px-5 pb-5 pt-10`}>
              <ModalClose
                onClick={() => setPlacedBet(null)}
                label="Close bet confirmation"
              />

              <div className="z-50 px-6 pb-4 pt-8 text-center">
                <h2 className="text-2xl font-extrabold leading-tight text-(--sb-accent)">
                  Congrats, Your Bet
                  <br />
                  is Booked.
                </h2>

                {placedBet.paidWithWallet ? (
                  <>
                    <p className="mt-4 rounded-lg border border-[#276249]/60 bg-[#0f241a]/80 px-3 py-2.5 text-sm leading-snug text-[#86efac]">
                      Your stake of{" "}
                      <span className="font-bold">{placedBet.stake} ETB</span>{" "}
                      was deducted — your bet is confirmed.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <p className="text-2xl font-bold tracking-wider text-[#ffffff]">
                        {placedBet.couponNumber || "—"}
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyCoupon}
                        title={copiedCoupon ? "Copied" : "Copy coupon number"}
                        aria-label={
                          copiedCoupon
                            ? "Copied to clipboard"
                            : "Copy coupon number"
                        }
                        className="flex cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-accent-surface-deep)/80 p-2 text-[#ffffff] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/45"
                      >
                        {copiedCoupon ? (
                          <AppIcon
                            name="check"
                            size={16}
                            className="text-(--sb-positive)"
                          />
                        ) : (
                          <AppIcon name="copy" size={16} />
                        )}
                      </button>
                    </div>

                    <p className="mt-4 text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
                      Please find a nearby Sokasport shop to pay and print your
                      slip.
                    </p>
                  </>
                )}

                {placedBet.usedLatestOdds ? (
                  <p className="mt-3 text-center text-xs font-semibold text-[#9ecbff]">
                    Odds were updated before placing
                  </p>
                ) : null}

                <p className="mt-2 text-xs italic text-(--sb-accent)">
                  All bets after kickoff are INVALID. All Terms and Conditions
                  fully Apply
                </p>
              </div>

              <div className="mx-5 rounded-[1rem] bg-gradient-to-br from-[#151528]/95 to-[#0c101c]/95 px-4 py-3 ring-1 ring-white/10 shadow-inner shadow-black/20">
                {placedBet.paidWithWallet ? (
                  <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                    <span className="text-[rgba(255,255,255,0.72)]">Payment</span>
                    <span className="font-semibold text-[#86efac]">
                      Paid {placedBet.stake} ETB
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Stake</span>
                  <span className="font-bold">{placedBet.stake} ETB</span>
                </div>
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Max Win</span>
                  <span className="font-bold">{placedBet.maxWin} ETB</span>
                </div>
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Total Odd</span>
                  <span className="font-bold">{placedBet.totalOdds}</span>
                </div>
                <div className="flex justify-between pt-2 text-sm font-extrabold">
                  <span>Net Pay</span>
                  <span className="text-(--sb-accent)">
                    {placedBet.netPay} ETB
                  </span>
                </div>
              </div>

              <div className="mx-5 mb-5 mt-4 overflow-hidden rounded-[1rem] ring-1 ring-white/10 shadow-inner shadow-black/20">
                <div className="flex items-center justify-between bg-(--sb-accent-fill) px-4 py-2 font-bold text-white">
                  <span>My Games</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8 bg-(--sb-accent-surface-deep)/70 text-[rgba(255,255,255,0.72)] backdrop-blur-sm">
                      <th className="px-2 py-2 text-left font-semibold">
                        Date
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Match
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Market
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Your Pick
                      </th>
                      <th className="px-2 py-2 text-right font-semibold">
                        ODD
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {placedBet.selections.map((sel) => {
                      const oddsParts = formatOddsChangeParts(sel);
                      return (
                        <tr
                          key={sel.id}
                          className="border-b border-[#2a2a3e] text-[#ffffff]"
                        >
                          <td className="whitespace-nowrap px-2 py-2">
                            {new Date().toLocaleDateString()}
                          </td>
                          <td className="px-2 py-2">{sel.matchName}</td>
                          <td className="px-2 py-2">{sel.marketLabel}</td>
                          <td className="px-2 py-2">{sel.label}</td>
                          <td className="px-2 py-2 text-right font-bold">
                            {oddsParts.previous ? (
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="font-normal text-[rgba(255,255,255,0.45)] line-through">
                                  {oddsParts.previous}
                                </span>
                                <span>{oddsParts.current}</span>
                                {oddsParts.direction === "up" ? (
                                  <span
                                    className="text-[#86efac]"
                                    aria-label="Odds increased"
                                  >
                                    ▲
                                  </span>
                                ) : null}
                                {oddsParts.direction === "down" ? (
                                  <span
                                    className="text-[#fca5a5]"
                                    aria-label="Odds decreased"
                                  >
                                    ▼
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              oddsParts.current
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default MobileBetSlip;
