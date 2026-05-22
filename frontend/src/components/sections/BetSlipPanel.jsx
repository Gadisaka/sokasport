import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AppIcon from "../common/AppIcon";
import {
  fetchPublicCouponTicket,
  hasAuthToken,
  placeBet,
} from "../../services/api";
import {
  isSelectionExpired,
  slipHasExpiredSelection,
} from "../../utils/selectionExpiry";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";
import { useActiveBonuses } from "../../hooks/useActiveBonuses";
import {
  clampStakeToUpperBound,
  coerceStakeDisplayToLimits,
  parseStakeNumeric,
  capGrossPotentialWin,
  stakeAndPotentialWinViolation,
  stakeBoundsInvalid,
  stakeLimitsHintParts,
} from "../../utils/stakeLimits";
import { mapCouponSelectionsToSlipRows } from "../../utils/couponTicketToSlip";
import {
  accumulatorBonusExtraGrossFormatted,
  accumulatorPercentFromBonusesList,
} from "../../utils/accumulatorBonus";
import { slipGrossTaxNet, winningsTaxLabel } from "../../utils/winningsTax";
import { useOddsSocket } from "../../hooks/useOddsSocket";

const slipDivider = "border-white/8";

const modalBackdrop =
  "fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm";

const modalPanel =
  "relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/96 via-(--sb-bg-2)/98 to-(--sb-bg-page)/96 px-5 pb-5 pt-10 text-[#ffffff] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

const modalPanelMd =
  "relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-(--sb-bg-2)/96 via-(--sb-bg-2)/98 to-(--sb-bg-page)/96 text-[#ffffff] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

function ModalClose({ onClick, label = "Close" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-(--sb-accent-surface-deep)/60 text-lg text-[rgba(255,255,255,0.72)] transition-all hover:bg-(--sb-bg-2)"
      aria-label={label}
    >
      ✕
    </button>
  );
}

const tabs = [
  { id: "betslip1", label: "Slip 1" },
  { id: "betslip2", label: "Slip 2" },
  { id: "betslip3", label: "Slip 3" },
];

function computePlacementSnapshot(
  selections,
  stakeNum,
  { limits, winningsTax, activeBonuses, lockedByFixture },
) {
  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some((sel) => {
    const fixtureId = Number(sel.apiFixtureId);
    return (
      Boolean(lockedByFixture[fixtureId]) ||
      String(sel.marketState || "").toUpperCase() === "LOCKED"
    );
  });
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

function BetSlipPanel({
  selections,
  onRemoveSelection,
  onClearSelections,
  activeSlip,
  onChangeSlip,
  onReplaceSelections = () => {},
}) {
  const [stakeInput, setStakeInput] = useState("20");
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
  const [, setTick] = useState(0);
  const { limits, winningsTax } = usePlatformSettings();
  const { bonuses: activeBonuses } = useActiveBonuses();
  const prevSelectionIdsRef = useRef(null);
  const [enterAnimIds, setEnterAnimIds] = useState(() => new Set());

  useEffect(() => {
    const ids = selections.map((s) => s.id);
    const prev = prevSelectionIdsRef.current;
    prevSelectionIdsRef.current = ids;
    if (prev === null) return;

    const prevSet = new Set(prev);
    const added = ids.filter((id) => !prevSet.has(id));
    if (added.length === 0) return;

    setEnterAnimIds((prevIds) => {
      const next = new Set(prevIds);
      added.forEach((id) => next.add(id));
      return next;
    });

    const timers = added.map((id) =>
      window.setTimeout(() => {
        setEnterAnimIds((prevIds) => {
          const next = new Set(prevIds);
          next.delete(id);
          return next;
        });
      }, 580),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [selections]);

  const stakeNum = parseStakeNumeric(stakeInput) ?? 0;

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

  useEffect(() => {
    if (!limits) return;
    setStakeInput((prev) => coerceStakeDisplayToLimits(prev, limits));
  }, [limits?.MIN_BET_AMOUNT, limits?.MAX_BET_AMOUNT]);

  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some((sel) => {
    const fixtureId = Number(sel.apiFixtureId);
    return (
      Boolean(lockedByFixture[fixtureId]) ||
      String(sel.marketState || "").toUpperCase() === "LOCKED"
    );
  });
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

  async function handlePlaceBet() {
    if (!selections.length || placing) return;
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
          const fixed = Number(row.serverOdds).toFixed(2);
          return {
            ...sel,
            acceptedOdds: Number(row.serverOdds),
            acceptedMarketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketState: row.marketState || sel.marketState || "OPEN",
            value: fixed,
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
                ? "One or more markets are locked. Please wait for unlock."
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
            ? "One or more markets are locked. Please wait for unlock."
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
      onReplaceSelections(rows);
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
      <section className="sb-card animate-deposit-panel flex min-h-[340px] flex-col overflow-hidden rounded-[1.15rem] backdrop-blur-sm">
        {/* Tab header with trash */}
        <div
          className={`flex items-center border-b bg-(--sb-accent-surface-deep)/35 p-2 backdrop-blur-md ${slipDivider}`}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeSlip(tab.id)}
              className={`mx-0.5 flex-1 cursor-pointer rounded-xl border py-2 text-[11px] font-bold transition-all duration-200 ${
                activeSlip === tab.id
                  ? "border-transparent bg-[#019052] text-white shadow-[0_6px_16px_-6px_rgba(1,144,82,0.3)]"
                  : "border-transparent bg-(--sb-accent-surface-deep)/45 text-[rgba(255,255,255,0.72)] hover:bg-(--sb-bg-2)"
              }`}
            >
              {tab.label}
            </button>
          ))}

          {selections.length > 0 && (
            <button
              type="button"
              onClick={onClearSelections}
              className="ml-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-[#6e7ea3] transition-colors hover:bg-[#2a1520]/50 hover:text-[#ff6b6b]"
            >
              <AppIcon name="trash" size={16} />
            </button>
          )}
        </div>

        <div
          className={`space-y-2 border-b bg-(--sb-accent-surface-deep)/25 px-2 pb-2.5 pt-2 backdrop-blur-sm ${slipDivider}`}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={loadCouponInput}
              onChange={(e) => setLoadCouponInput(e.target.value)}
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
              onChange={(e) => setCheckCouponInput(e.target.value)}
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

        {/* Content */}
        {selections.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-[rgba(255,255,255,0.72)]">
            Click on odds to add selections to your bet slip. Minimum 3, maximum
            30 selections.
          </div>
        ) : (
          <>
            {/* Selections */}
            <div className="flex-1 overflow-x-hidden overflow-y-auto">
              {selections.map((sel) => {
                const expired = isSelectionExpired(sel);
                const rowEnter = enterAnimIds.has(sel.id);
                return (
                  <div
                    key={sel.id}
                    className={`flex items-center gap-2.5 border-b px-2.5 py-2.5 transition-colors ${slipDivider} ${
                      expired ? "bg-[#2a1515]/55" : "hover:bg-(--sb-accent-surface-deep)/25"
                    } ${rowEnter ? "animate-bet-slip-row-enter" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onRemoveSelection(sel.id)}
                      className="shrink-0 cursor-pointer border-0 bg-transparent text-[#67799f] hover:text-[#ff6b6b]"
                    >
                      <AppIcon name="trash" size={14} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div
                          className={`text-[13px] font-bold ${
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
                        className={`text-[11px] font-medium ${
                          expired ? "text-[#f87171]/90" : "text-[rgba(255,255,255,0.72)]"
                        }`}
                      >
                        {sel.marketLabel} : {sel.label}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[15px] font-extrabold ${
                        expired
                          ? "text-[#f87171]"
                          : "text-(--sb-accent-text-muted)"
                      }`}
                    >
                      {sel.value}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Total ODDS */}
            <div
              className={`flex items-center justify-between border-t px-3 py-2.5 ${slipDivider} bg-(--sb-accent-surface-deep)/20`}
            >
              <span className="text-sm font-extrabold text-[#ffffff]">
                Total ODDS
              </span>
              <span className="text-sm font-extrabold text-(--sb-accent-text-muted)">
                {totalOdds}
              </span>
            </div>

            {accPct > 0 &&
            selections.length > 0 &&
            !hasExpiredSelection &&
            accBonusExtraEtb != null ? (
              <div
                className={`flex items-center justify-between border-t px-3 py-2 ${slipDivider} bg-[#0f3d2e]/35`}
              >
                <span className="text-xs font-semibold text-[#86efac]/95">
                  Accumulator bonus
                </span>
                <span className="flex flex-col items-end text-xs font-extrabold text-[#86efac]">
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

            {/* Stake input */}
            <div
              className={`mx-3 mb-3 flex h-12 items-center rounded-2xl border-0 bg-(--sb-accent-surface-deep)/75 shadow-inner shadow-black/25 ring-1 ${
                stakeFieldInvalid ? "ring-[#b91c1c]/55" : "ring-white/10"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setStakeInput((s) =>
                    String(
                      clampStakeToUpperBound(
                        limits,
                        (parseStakeNumeric(s) ?? 0) - 10,
                      ),
                    ),
                  )
                }
                className="ml-1.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-bg-2)/80 text-[rgba(255,255,255,0.72)] ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/30"
              >
                <AppIcon name="minus" size={18} strokeWidth={2.5} />
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={stakeInput}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setStakeInput("");
                    return;
                  }
                  const n = Number(v);
                  if (!Number.isFinite(n)) return;
                  setStakeInput(String(clampStakeToUpperBound(limits, n)));
                }}
                className={`h-full w-full border-0 bg-transparent text-center text-base font-extrabold outline-none ${
                  stakeFieldInvalid ? "text-[#fecaca]" : "text-[#ffffff]"
                }`}
              />
              <button
                type="button"
                onClick={() =>
                  setStakeInput((s) =>
                    String(
                      clampStakeToUpperBound(
                        limits,
                        (parseStakeNumeric(s) ?? 0) + 10,
                      ),
                    ),
                  )
                }
                className="mr-1.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-(--sb-bg-2)/80 text-[rgba(255,255,255,0.72)] ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/30"
              >
                <AppIcon name="plus" size={18} strokeWidth={2.5} />
              </button>
            </div>
            {stakeHintParts.length > 0 ? (
              <p className="mx-3 mb-1 text-[10px] leading-snug text-[#6e7ea3]">
                {stakeHintParts.join(" · ")}
              </p>
            ) : null}
            {stakeViolation ? (
              <p className="mx-3 mb-2 text-[11px] font-semibold leading-snug text-[#ff8a8a]">
                {stakeViolation}
              </p>
            ) : null}

            {/* Summary */}
            <div
              className={`border-t px-3 py-2.5 ${slipDivider} bg-(--sb-accent-surface-deep)/20`}
            >
              <div className="flex items-center justify-between py-1">
                <span className="flex items-center gap-1 text-xs font-bold text-[#90a2c7]">
                  {winningsTaxLabel(winningsTax)}
                </span>
                <div className="flex items-center gap-1">
                  <AppIcon
                    name="chevronDown"
                    size={12}
                    className="text-[#67799f]"
                  />
                  <span className="text-xs font-bold text-[#ffffff]">
                    {tax === "—" ? "—" : `${tax} ETB`}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-extrabold text-[#ffffff]">
                  Net Win/Payout
                </span>
                <span className="text-sm font-extrabold text-(--sb-accent-text-muted)">
                  {netWin === "—" ? "—" : `${netWin} ETB`}
                </span>
              </div>
            </div>
          </>
        )}

        {selections.length > 0 && hasExpiredSelection ? (
          <div className="border-t border-[#5f3030]/40 bg-[#2a1515]/40 px-3 py-2.5 text-center text-[11px] font-bold text-[#fecaca]">
            Remove expired matches to enable placing this bet.
          </div>
        ) : null}
        {selections.length > 0 && hasLockedSelection ? (
          <div className="border-t border-[#5f3030]/40 bg-[#2a1515]/40 px-3 py-2.5 text-center text-[11px] font-bold text-[#fecaca]">
            One or more markets are LOCKED. Placement is temporarily disabled.
          </div>
        ) : null}

        {betResult && (
          <div
            className={`mx-0 px-3 py-2.5 text-center text-xs font-bold ${
              betResult.type === "success"
                ? "bg-(--sb-accent-surface)/55 text-[#ffffff] ring-1 ring-(--sb-accent-fill)/30"
                : "bg-[#3a1515]/90 text-[#ff6b6b] ring-1 ring-red-900/30"
            }`}
          >
            {betResult.message}
          </div>
        )}

        {/* Place bet button */}
        <button
          type="button"
          disabled={
            placing ||
            !selections.length ||
            hasExpiredSelection ||
            hasLockedSelection ||
            Boolean(stakeViolation)
          }
          onClick={handlePlaceBet}
          className="mt-auto flex w-full cursor-pointer items-center justify-center rounded-b-[1.1rem] border-0 bg-(--sb-accent-fill) py-3.5 text-base font-extrabold tracking-wide text-white shadow-[0_12px_28px_-8px_rgba(1,144,82,0.45)] transition-all hover:bg-(--sb-accent-fill-hover) hover:shadow-[0_16px_32px_-8px_rgba(1,144,82,0.52)] disabled:pointer-events-none disabled:opacity-50"
        >
          {placing ? "PLACING..." : "PLACE BET"}
        </button>
      </section>
      {couponCheckPreview &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483646 }}>
            <div className={modalPanel}>
              <ModalClose
                onClick={() => setCouponCheckPreview(null)}
                label="Close ticket preview"
              />
              <div className="mb-4 text-center">
                <h2 className="text-xl font-extrabold text-(--sb-accent)">
                  Coupon template
                </h2>
                <p className="mt-1 font-mono text-lg font-bold tracking-wide text-[#ffffff]">
                  {couponCheckPreview.couponNumber}
                </p>
                <p className="mt-3 text-left text-xs leading-relaxed text-[rgba(255,255,255,0.72)]">
                  This shows the selections linked to this coupon code. Stake,
                  status, and payout use your receipt number (issued when you
                  pay or when the slip is printed at the shop).
                </p>
              </div>
              <div className="overflow-hidden rounded-[1rem]  shadow-inner shadow-black/20">
                <div className="bg-(--sb-accent-fill) px-3 py-2 text-sm font-bold text-white">
                  Games on this coupon
                </div>
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-white/8 bg-(--sb-accent-surface-deep)/70 text-[rgba(255,255,255,0.72)] backdrop-blur-sm">
                      <th className="px-2 py-2 font-semibold">Match</th>
                      <th className="px-2 py-2 font-semibold">Market</th>
                      <th className="px-2 py-2 font-semibold">Pick</th>
                      <th className="px-2 py-2 text-right font-semibold">
                        Odds
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(couponCheckPreview.selections || []).map((sel, idx) => (
                      <tr
                        key={`${couponCheckPreview.couponNumber}-${idx}`}
                        className="border-b border-[#2a2a3e] text-[#ffffff]"
                      >
                        <td className="max-w-[120px] px-2 py-2 align-top">
                          {sel.matchName}
                        </td>
                        <td className="px-2 py-2 align-top">
                          {sel.marketLabel}
                        </td>
                        <td className="px-2 py-2 align-top">{sel.label}</td>
                        <td className="px-2 py-2 text-right align-top font-bold">
                          {Number(sel.odds).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {/* Bet confirmation modal */}
      {placedBet &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483647 }}>
            <div className={`${modalPanelMd} px-5 pb-5 pt-10`}>
              <ModalClose
                onClick={() => setPlacedBet(null)}
                label="Close bet confirmation"
              />

              {/* Header */}
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
                    Latest odds used
                  </p>
                ) : null}

                <p className="mt-2 text-xs italic text-(--sb-accent)">
                  All bets after kickoff are INVALID. All Terms and Conditions
                  fully Apply
                </p>
              </div>

              {/* Bet summary */}
              <div className="mx-5 rounded-[1rem] bg-gradient-to-br from-[#151528]/95 to-[#0c101c]/95 px-4 py-3  shadow-inner shadow-black/20">
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

              {/* My Games table */}
              <div className="mx-5 mb-5 mt-4 overflow-hidden rounded-[1rem]  shadow-inner shadow-black/20">
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
                    {placedBet.selections.map((sel) => (
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
                          {sel.value}
                        </td>
                      </tr>
                    ))}
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

export default BetSlipPanel;
