import { useEffect, useMemo, useRef, useState } from "react";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import Modal from "../../components/ui/Modal";
import TicketTemplate from "../../components/ticket/TicketTemplate";
import { useTicketPrint } from "../../components/ticket/useTicketPrint";
import {
  encodeTicketAsync,
  encodeActionReceiptAsync,
} from "../../components/ticket/escpos";
import { print as printViaLocalService } from "../../services/localPrinter";
import { useAuth } from "../../context/AuthContext";
import { API_URL } from "../../../constants.js";
import { formatCouponInput } from "../../utils/formatCouponInput";
import {
  useCashoutQuoteMutation,
  useCashbackQuoteMutation,
  usePayCashbackMutation,
  mapTicketDetail,
  useCancelTicketMutation,
  useConfirmPrintedTicketMutation,
  useAbortPrintTicketMutation,
  usePreparePrintTicketMutation,
  useCouponLookupMutation,
  useExecuteCashoutMutation,
  usePayoutTicketMutation,
  useReceiptLookupMutation,
  useRemoveTicketSelectionMutation,
  useSellBlockingQuery,
  useTicketByIdLookupMutation,
  useTodayTicketsQuery,
  useUpdateTicketStakeMutation,
} from "../../hook/useCashierTickets";
import { useCashierHistoryQuery } from "../../hook/useCashierWallet";
import { useNotificationUnreadCountQuery } from "../../hook/useNotifications";
import CashierInboxList from "../../components/notifications/CashierInboxList";
import { capGrossPotentialWin } from "../../utils/bettingStakeLimits";
import {
  formatTaxLineLabel,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax";
import { getSelectionRowClass } from "../../utils/legResultStatus";
import {
  collectInvalidSelectionIds,
  invalidSelectionLabel,
  removableExpiredSelectionIds,
} from "../../utils/selectionExpiry";

const LEFT_TABS = [
  { id: "sell", label: "Sell Ticket" },
  { id: "payout", label: "Payout and Cancel" },
];

const RIGHT_TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "canceled", label: "Canceled Slips" },
  { id: "all", label: "All Slips" },
];

const PRINTED_STORAGE_KEY = "cashier:printedTicketIds";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const INSUFFICIENT_CASHIER_BALANCE_MESSAGE = "Insufficient cashier balance";

function formatCurrency(value) {
  return `${toNumber(value).toLocaleString()} ETB`;
}

const CASHBACK_REASON_LABELS = {
  eligible: "Eligible",
  inactive: "Cashback is turned off",
  no_ticket: "Ticket not found",
  no_tiers: "No cashback tiers configured",
  invalid_stake: "Invalid stake",
  below_min_stake: "Stake is below the minimum",
  too_few_selections: "Not enough bets on the ticket",
  outside_time_window: "Outside the 48-hour claim window",
  disqualified_selection: "Ticket has a postponed, canceled, or suspended match",
  no_lost_leg: "No lost bet on this ticket",
  invalid_total_odds: "Invalid ticket odds",
  below_min_result: "Loss ratio is below the minimum",
  no_matching_tier: "No matching cashback tier",
  non_positive_amount: "Cashback amount is zero",
  leg_odds_below_min: "A bet on the ticket is below the minimum odds",
  too_many_lost_legs: "More than two lost bets — cashback is only for 1 or 2 losses",
  live_leg_excluded: "Live bets are not eligible for online cashback",
  no_matching_profile: "No cashback profile for this number of lost bets",
  pending_legs: "Some matches on this ticket have not finished yet",
  already_paid: "Cashback already paid",
  ticket_not_lost: "Cashback is only available for lost tickets",
  not_cashier_ticket: "Cashback is only available for printed tickets",
  ticket_not_found: "Ticket not found",
  not_eligible: "Not eligible for cashback",
};

const CASHBACK_PROFILE_LABELS = {
  oneLoss: "1 loss",
  twoLoss: "2 losses",
};

function cashbackReasonLabel(code) {
  if (!code) return "unavailable";
  return CASHBACK_REASON_LABELS[code] || code;
}

const PRINT_DRIFT_CODES = new Set(["odds_changed", "market_version_changed"]);
const MAX_PRINT_DRIFT_RETRIES = 3;

function positiveMarketVersion(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Merge a 409 drift response into the running accept map, keyed by leg index.
 *
 * Drift is reported one code at a time (version drift outranks odds drift), so
 * accepting must carry forward everything seen so far — rebuilding from the
 * latest response alone would re-submit stale values for the other field.
 */
function mergeAcceptedDriftRows(acceptedByIndex, changedRows, ticket) {
  const snapshotSelections = Array.isArray(ticket?.selections)
    ? ticket.selections
    : [];
  for (const row of changedRows) {
    const idx = Number(row?.index);
    if (!Number.isFinite(idx)) continue;
    const fromTicket = snapshotSelections[idx];
    const previous = acceptedByIndex.get(idx) || { index: idx };
    const serverOdds = Number(row?.serverOdds);
    const acceptedOdds = Number.isFinite(serverOdds)
      ? serverOdds
      : Number(previous.acceptedOdds ?? fromTicket?.odds);
    const next = { index: idx, acceptedOdds };
    const acceptedMarketVersion =
      positiveMarketVersion(row?.serverMarketVersion) ??
      previous.acceptedMarketVersion ??
      positiveMarketVersion(fromTicket?.serverMarketVersion);
    if (acceptedMarketVersion != null) {
      next.acceptedMarketVersion = acceptedMarketVersion;
    }
    acceptedByIndex.set(idx, next);
  }
  return [...acceptedByIndex.values()];
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function readPrintedCache() {
  try {
    const raw = localStorage.getItem(PRINTED_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writePrintedCache(setValue) {
  localStorage.setItem(PRINTED_STORAGE_KEY, JSON.stringify([...setValue]));
}

function TicketDetail({
  ticket,
  platformWinningsTax = null,
  highlightSelections = false,
  highlightInvalid = false,
  invalidSelectionIds = null,
  blockingLegs = [],
  onRemoveSelection,
  removeDisabled = false,
  removingSelectionId = null,
}) {
  if (!ticket) return null;

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxLabel = formatTaxLineLabel(ticket, platformWinningsTax);
  const showActions = typeof onRemoveSelection === "function";
  const invalidIds =
    invalidSelectionIds instanceof Set ? invalidSelectionIds : new Set();

  return (
    <div className="mt-4 overflow-hidden rounded-sm border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span className="block font-mono">Coupon {ticket.couponNumber}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Selection</th>
              <th className="px-3 py-2">Odd</th>
              {showActions ? <th className="px-3 py-2"> </th> : null}
            </tr>
          </thead>
          <tbody>
            {(ticket.selections || []).map((selection) => {
              const home = selection.match?.homeTeam ?? "";
              const away = selection.match?.awayTeam ?? "";
              const matchLabel =
                selection.match && String(away).trim()
                  ? `${home} vs ${away}`
                  : selection.match
                    ? home || "-"
                    : "-";
              const marketText = String(selection.marketLabel ?? "").trim();
              const isInvalid =
                highlightInvalid && invalidIds.has(String(selection.id));
              const rowHighlightClass = isInvalid
                ? "bg-[#fee2e2]"
                : highlightSelections
                  ? getSelectionRowClass(selection)
                  : "";
              return (
                <tr
                  key={selection.id}
                  className={`border-b border-[var(--border)] last:border-0 ${rowHighlightClass}`.trim()}
                >
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    <div>
                      {selection.match?.startTime
                        ? new Date(selection.match.startTime).toLocaleString()
                        : "-"}
                    </div>
                    {isInvalid ? (
                      <span className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wide text-[#b91c1c]">
                        {invalidSelectionLabel(selection.id, blockingLegs)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{matchLabel}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {marketText || "-"}
                  </td>
                  <td className="px-3 py-2 text-xs">{selection.selection}</td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {toNumber(selection.odds).toFixed(2)}
                  </td>
                  {showActions ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRemoveSelection(selection.id)}
                        disabled={
                          removeDisabled ||
                          (removingSelectionId != null &&
                            String(removingSelectionId) ===
                              String(selection.id))
                        }
                        className="rounded-sm border border-[#b91c1c]/40 px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-1 border-t border-[var(--border)] px-3 py-3 text-sm">
        <p>
          <span className="font-semibold">Stake:</span>{" "}
          {formatCurrency(ticket.stake)}
        </p>
        <p>
          <span className="font-semibold">Total Odds:</span>{" "}
          {toNumber(ticket.totalOdds).toFixed(2)}
        </p>
        {showTax ? (
          <>
            <p>
              <span className="font-semibold">Gross win:</span>{" "}
              {formatCurrency(gross)}
            </p>
            <p>
              <span className="font-semibold">{taxLabel}:</span>{" "}
              {formatCurrency(tax)}
            </p>
            <p>
              <span className="font-semibold">Net payout:</span>{" "}
              {formatCurrency(net)}
            </p>
          </>
        ) : (
          <p>
            <span className="font-semibold">Possible Win:</span>{" "}
            {formatCurrency(ticket.potentialWin)}
          </p>
        )}
        <p>
          <span className="font-semibold">Status:</span>{" "}
          <span className="font-mono">{ticket.status}</span>
        </p>
      </div>
    </div>
  );
}

function SlipsTable({ items, page, totalPages, onPageChange }) {
  return (
    <PanelCard className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-3">Time</th>
              <th className="px-3 py-3">Coupon</th>
              <th className="px-3 py-3">Amount</th>
              <th className="px-3 py-3">Possible Win</th>
              <th className="px-3 py-3">Printed</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-xs text-[var(--muted)]"
                >
                  No slips found for today.
                </td>
              </tr>
            ) : (
              items.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-3 text-xs">
                    {formatTime(ticket.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-xs font-mono">
                    {ticket.couponNumber}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {toNumber(ticket.stake).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {formatCurrency(ticket.potentialWin)}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {ticket.printed ? (
                      <span className="text-[var(--muted)]">Reprint</span>
                    ) : (
                      <span className="text-[var(--muted)]">No</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-3 py-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded-sm border border-[var(--border)] px-2 py-1 disabled:opacity-50"
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </button>
          <span className="text-[var(--muted)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="rounded-sm border border-[var(--border)] px-2 py-1 disabled:opacity-50"
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </PanelCard>
  );
}

export default function CashierTicketsPage() {
  const { user, logout } = useAuth();
  const [leftTab, setLeftTab] = useState("sell");
  const [rightTab, setRightTab] = useState("inbox");
  const [slipsPage, setSlipsPage] = useState(1);

  const [sellCouponInput, setSellCouponInput] = useState("");
  const [payoutReceiptInput, setPayoutReceiptInput] = useState("");
  const [sellTicket, setSellTicket] = useState(null);
  const [sellStakeInput, setSellStakeInput] = useState("");
  const [payoutTicket, setPayoutTicket] = useState(null);
  const [payoutQuote, setPayoutQuote] = useState(null);
  const [payoutAction, setPayoutAction] = useState("payout");
  const [completedAction, setCompletedAction] = useState(null);
  const [sellError, setSellError] = useState("");
  const [payoutError, setPayoutError] = useState("");
  const [sellConfirmed, setSellConfirmed] = useState(false);
  const [ticketPreviewOpen, setTicketPreviewOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [printedCache, setPrintedCache] = useState(() => readPrintedCache());
  const [platformWinningsTax, setPlatformWinningsTax] = useState(null);
  const [bettingLimits, setBettingLimits] = useState(null);
  const printInFlightRef = useRef(false);
  const autoRemoveExpiredInFlightRef = useRef(false);
  const [expiryTick, setExpiryTick] = useState(0);
  const [removingSelectionId, setRemovingSelectionId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/cms/platform-config`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (data?.winningsTax) {
            setPlatformWinningsTax(data.winningsTax);
          }
          if (data?.limits != null) {
            setBettingLimits(data.limits);
          }
        }
      } catch {
        if (!cancelled) {
          setPlatformWinningsTax(null);
          setBettingLimits(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lookupCoupon = useCouponLookupMutation();
  const lookupReceipt = useReceiptLookupMutation();
  const loadTicketById = useTicketByIdLookupMutation();
  const cancelTicket = useCancelTicketMutation();
  const payoutTicketMutation = usePayoutTicketMutation();
  const cashoutQuoteMutation = useCashoutQuoteMutation();
  const executeCashoutMutation = useExecuteCashoutMutation();
  const cashbackQuoteMutation = useCashbackQuoteMutation();
  const payCashbackMutation = usePayCashbackMutation();
  const confirmPrint = useConfirmPrintedTicketMutation();
  const abortPrint = useAbortPrintTicketMutation();
  const preparePrint = usePreparePrintTicketMutation();
  const updateStake = useUpdateTicketStakeMutation();
  const removeSelection = useRemoveTicketSelectionMutation();
  const sellBlockingQuery = useSellBlockingQuery(sellTicket?.id, {
    enabled: Boolean(sellTicket?.id && leftTab === "sell"),
  });

  useEffect(() => {
    if (leftTab !== "sell") return undefined;
    const id = window.setInterval(() => setExpiryTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [leftTab]);

  const invalidSelectionIds = useMemo(() => {
    if (!sellTicket?.selections) return new Set();
    return collectInvalidSelectionIds(
      sellTicket.selections,
      sellBlockingQuery.data?.blockingLegs,
    );
  }, [sellTicket, sellBlockingQuery.data?.blockingLegs]);

  const hasInvalidLegs = invalidSelectionIds.size > 0;
  const onlyOneLeg = (sellTicket?.selections?.length || 0) <= 1;

  const sellStakeNum = Number(sellStakeInput);
  const sellAccPct = toNumber(sellTicket?.accumulatorBonusPercent);
  const sellRawGrossPotential =
    sellTicket &&
    Number.isFinite(sellStakeNum) &&
    sellStakeNum > 0 &&
    Number.isFinite(toNumber(sellTicket.totalOdds))
      ? sellStakeNum * toNumber(sellTicket.totalOdds) * (1 + sellAccPct / 100)
      : 0;
  const sellCappedPossibleWin = capGrossPotentialWin(
    bettingLimits,
    sellRawGrossPotential,
  );
  const sellTaxBreakdown = slipGrossTaxNetForTicket(
    sellCappedPossibleWin,
    sellTicket,
  );
  const sellShowTax = sellTaxBreakdown.tax != null && sellTaxBreakdown.tax > 0;

  const ticketForPrint = sellTicket
    ? {
        ...sellTicket,
        cashierId: sellTicket.cashierId || user?.cashierId || user?.id || "",
        cashierName:
          String(sellTicket.cashierName || "").trim() ||
          user?.fullname ||
          user?.username ||
          "",
      }
    : null;
  const {
    ticketRef,
    barcodeDataUrl,
    downloadPdf,
    pdfBusy,
    printerStatus,
    refreshPrinterStatus,
    testPrint,
    lastError: printError,
  } = useTicketPrint(ticketForPrint, {
    width: "80mm",
    platformWinningsTax,
  });

  const slipsStatus = rightTab === "canceled" ? "CANCELED" : "";
  const slipsEnabled = rightTab !== "inbox";
  const walletQuery = useCashierHistoryQuery({ page: 1 });
  const cashierBalance = walletQuery.data?.balance;
  const stakeForFloatGate = Number.isFinite(sellStakeNum) && sellStakeNum > 0
    ? sellStakeNum
    : toNumber(sellTicket?.stake);
  const insufficientFloat =
    Boolean(sellTicket) &&
    cashierBalance != null &&
    Number.isFinite(stakeForFloatGate) &&
    stakeForFloatGate > 0 &&
    toNumber(cashierBalance) < stakeForFloatGate;
  const slipsQuery = useTodayTicketsQuery({
    status: slipsStatus,
    page: slipsPage,
    limit: 10,
    enabled: slipsEnabled,
  });
  const unreadQuery = useNotificationUnreadCountQuery();
  const inboxUnread = unreadQuery.data?.count ?? 0;

  const slipsItems = Array.isArray(slipsQuery.data?.items)
    ? slipsQuery.data.items
    : [];
  const slipsData = slipsItems.map((ticket) => ({
    ...ticket,
    printed: ticket.printed || printedCache.has(ticket.id),
  }));

  const totalPages = slipsQuery.data?.totalPages || 1;
  const isBusy =
    lookupCoupon.isPending ||
    lookupReceipt.isPending ||
    loadTicketById.isPending ||
    cancelTicket.isPending ||
    payoutTicketMutation.isPending ||
    cashoutQuoteMutation.isPending ||
    executeCashoutMutation.isPending ||
    cashbackQuoteMutation.isPending ||
    payCashbackMutation.isPending ||
    confirmPrint.isPending ||
    abortPrint.isPending ||
    preparePrint.isPending ||
    updateStake.isPending;
  const printerConnected = Boolean(printerStatus?.connected);
  const printerPort = printerStatus?.port || "";
  const printerQueueLength = Number(printerStatus?.queueLength) || 0;
  const printerProcessing = Boolean(printerStatus?.processing);
  const printerLastError = printerStatus?.lastError || "";
  const printerQueueActive = printerProcessing || printerQueueLength > 0;

  const setPrintedTicket = (ticketId) => {
    setPrintedCache((prev) => {
      const next = new Set(prev);
      next.add(ticketId);
      writePrintedCache(next);
      return next;
    });
  };

  const loadCouponTicket = async ({
    type,
    couponNumber,
    receiptNumber,
    payoutMode = "payout",
  }) => {
    const isSell = type === "sell";
    const trimmedCoupon = String(couponNumber || "").trim();
    const trimmedReceipt = String(receiptNumber || "").trim();
    if (isSell && !trimmedCoupon) return;
    if (!isSell && !trimmedReceipt) return;

    setActionSuccess("");
    if (isSell) {
      setSellError("");
      setSellConfirmed(false);
      setTicketPreviewOpen(false);
    } else {
      setPayoutError("");
      setPayoutQuote(null);
      setCompletedAction(null);
    }

    try {
      if (isSell) {
        const ticket = await lookupCoupon.mutateAsync(trimmedCoupon);
        setSellTicket(ticket);
        setSellStakeInput(String(toNumber(ticket?.stake)));
      } else {
        const ticket = await lookupReceipt.mutateAsync(trimmedReceipt);
        setPayoutTicket(ticket);
        if (payoutMode === "cashout") {
          const quotePayload = await cashoutQuoteMutation.mutateAsync(
            ticket.id,
          );
          setPayoutQuote(quotePayload?.quote || null);
        }
      }
    } catch (error) {
      if (isSell) {
        setSellTicket(null);
        setSellStakeInput("");
        setSellError(error?.message || "Failed to load ticket");
      } else {
        setPayoutTicket(null);
        setPayoutQuote(null);
        setPayoutError(error?.message || "Failed to load ticket");
      }
    }
  };

  const handleCouponLookup = async (type) => {
    if (type === "sell") {
      await loadCouponTicket({
        type: "sell",
        couponNumber: sellCouponInput,
        payoutMode: payoutAction,
      });
    } else {
      await loadCouponTicket({
        type: "payout",
        receiptNumber: payoutReceiptInput,
        payoutMode: payoutAction,
      });
    }
  };

  const handleSellConfirm = async () => {
    if (!sellTicket) return;
    setSellError("");

    if (hasInvalidLegs) {
      setSellError("Remove expired or invalid selections before confirming.");
      return;
    }

    if (insufficientFloat) {
      setSellError(INSUFFICIENT_CASHIER_BALANCE_MESSAGE);
      return;
    }

    const parsedStake = Number(sellStakeInput);
    if (!Number.isFinite(parsedStake) || parsedStake <= 0) {
      setSellError("Stake must be a positive number");
      return;
    }

    const currentStake = toNumber(sellTicket.stake);
    if (parsedStake !== currentStake) {
      try {
        const updated = await updateStake.mutateAsync({
          ticketId: sellTicket.id,
          stake: parsedStake,
        });
        setSellTicket(updated);
      } catch (error) {
        setSellError(error?.message || "Failed to update stake");
        return;
      }
    }

    setSellConfirmed(true);
    setActionSuccess("Ticket confirmed. You can print now.");
  };

  const handleRemoveSelection = async (selectionId) => {
    if (!sellTicket?.id) return;
    setSellError("");
    setSellConfirmed(false);
    setRemovingSelectionId(selectionId);
    try {
      const updated = await removeSelection.mutateAsync({
        ticketId: sellTicket.id,
        selectionId,
      });
      setSellTicket(updated);
      setSellStakeInput(String(toNumber(updated?.stake)));
    } catch (error) {
      setSellError(error?.message || "Failed to remove selection");
    } finally {
      setRemovingSelectionId(null);
    }
  };

  const sellBlockingLegs = sellBlockingQuery.data?.blockingLegs;
  const removeSelectionMutateAsync = removeSelection.mutateAsync;
  const sellSelectionIdsKey = (sellTicket?.selections || [])
    .map((row) => String(row?.id || ""))
    .join("|");
  const blockingStartedKey = (sellBlockingLegs || [])
    .filter((leg) => String(leg?.code || "") === "fixture_started")
    .map((leg) => String(leg?.selectionId || ""))
    .join("|");

  useEffect(() => {
    if (leftTab !== "sell" || !sellTicket?.id || sellConfirmed) return undefined;
    if (autoRemoveExpiredInFlightRef.current) return undefined;

    const ids = removableExpiredSelectionIds(
      sellTicket.selections,
      Date.now(),
      sellBlockingLegs,
    );
    if (ids.length === 0) return undefined;

    let cancelled = false;
    autoRemoveExpiredInFlightRef.current = true;

    (async () => {
      try {
        let updated = sellTicket;
        let removed = 0;
        for (const selectionId of ids) {
          if (cancelled) break;
          const stillOnTicket = (updated.selections || []).some(
            (s) => String(s.id) === String(selectionId),
          );
          if (!stillOnTicket) continue;
          setRemovingSelectionId(selectionId);
          try {
            updated = await removeSelectionMutateAsync({
              ticketId: updated.id,
              selectionId,
            });
            removed += 1;
          } catch (err) {
            const msg = String(err?.message || "").toLowerCase();
            if (msg.includes("not found")) continue;
            throw err;
          }
        }
        if (cancelled || removed === 0) return;
        setSellTicket(updated);
        setSellStakeInput(String(toNumber(updated?.stake)));
        setSellConfirmed(false);
        setActionSuccess(
          removed === 1
            ? "Removed 1 expired selection."
            : `Removed ${removed} expired selections.`,
        );
      } catch (error) {
        if (!cancelled) {
          setSellError(error?.message || "Failed to remove expired selections");
        }
      } finally {
        autoRemoveExpiredInFlightRef.current = false;
        setRemovingSelectionId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    leftTab,
    sellTicket,
    sellConfirmed,
    expiryTick,
    sellSelectionIdsKey,
    blockingStartedKey,
    sellBlockingLegs,
    removeSelectionMutateAsync,
  ]);

  const handlePrint = async () => {
    if (!sellTicket || printInFlightRef.current) return;
    printInFlightRef.current = true;
    setSellError("");
    const ticketForWalletAndPrint = sellTicket;

    const runWithDriftRetry = async (mutateAsync, basePayload) => {
      const acceptedByIndex = new Map();
      let payload = basePayload;
      for (let attempt = 0; attempt <= MAX_PRINT_DRIFT_RETRIES; attempt++) {
        try {
          return await mutateAsync(payload);
        } catch (error) {
          const driftCode = String(error?.code || "");
          if (
            !PRINT_DRIFT_CODES.has(driftCode) ||
            !error?.details ||
            attempt >= MAX_PRINT_DRIFT_RETRIES
          ) {
            throw error;
          }
          const changedRows = Array.isArray(error.details.selections)
            ? error.details.selections
            : [];
          setActionSuccess("Accepting updated market...");
          payload = {
            ...basePayload,
            acceptOddsChanges: true,
            selections: mergeAcceptedDriftRows(
              acceptedByIndex,
              changedRows,
              ticketForWalletAndPrint,
            ),
          };
        }
      }
      throw new Error("Failed to accept updated market. Try print again.");
    };

    const localPrintFailMessage = (result) => {
      if (result?.code === "service_unreachable") {
        return "Local print service unreachable. Start PrinterBridge.exe on this PC.";
      }
      if (result?.code === "com_unavailable") {
        return "Printer queue unavailable. Check POS80 is installed in Windows Print queues.";
      }
      return String(
        result?.error?.message ||
          "Failed to send ticket to local printer service.",
      );
    };

    let holdTaken = false;
    let holdReleased = false;
    let paperSent = false;
    const releasePrintHold = async () => {
      if (!holdTaken || holdReleased || paperSent) return true;
      try {
        await abortPrint.mutateAsync({
          ticketId: ticketForWalletAndPrint.id,
        });
        holdReleased = true;
        await walletQuery.refetch();
        return true;
      } catch {
        return false;
      }
    };
    const heldStakeMessage =
      " Stake was taken. Retry print or cancel the ticket to refund.";

    try {
      // Fail fast when the printer is offline — before any network call.
      if (!printerConnected) {
        setSellError(
          "Printer offline. Ensure local print service is running and POS80 printer is connected.",
        );
        setTicketPreviewOpen(false);
        return;
      }

      setActionSuccess("Validating ticket before print...");
      const prepareResult = await runWithDriftRetry(preparePrint.mutateAsync, {
        ticketId: ticketForWalletAndPrint.id,
      });
      holdTaken = true;
      void walletQuery.refetch();
      const ticketToPrint = prepareResult?.ticket
        ? mapTicketDetail(prepareResult.ticket)
        : ticketForWalletAndPrint;

      setActionSuccess("Sending ticket to printer...");
      const escposData = await encodeTicketAsync(ticketToPrint, {
        width: "80mm",
        platformWinningsTax,
      });
      const localPrintResult = await printViaLocalService(escposData);
      if (!localPrintResult.success) {
        const aborted = await releasePrintHold();
        setActionSuccess("");
        const printMessage = localPrintFailMessage(localPrintResult);
        setSellError(aborted ? printMessage : `${printMessage}${heldStakeMessage}`);
        setTicketPreviewOpen(false);
        return;
      }
      paperSent = true;

      setActionSuccess("Print sent. Confirming sale...");
      let confirmResult;
      try {
        confirmResult = await runWithDriftRetry(confirmPrint.mutateAsync, {
          ticketId: ticketForWalletAndPrint.id,
        });
      } catch (error) {
        if (error?.code === "status_conflict") {
          const existing = await loadTicketById.mutateAsync(
            ticketForWalletAndPrint.id,
          );
          if (existing?.status === "PRINTED") {
            confirmResult = { alreadyPrinted: true, deductedAmount: 0, ticket: existing };
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      setPrintedTicket(ticketForWalletAndPrint.id);

      let updatedTicket;
      if (confirmResult?.ticket) {
        updatedTicket = mapTicketDetail(confirmResult.ticket);
      } else {
        updatedTicket = await loadTicketById.mutateAsync(
          ticketForWalletAndPrint.id,
        );
      }
      setSellTicket(updatedTicket);

      Promise.all([slipsQuery.refetch(), walletQuery.refetch()]).catch(() => {});

      const confirmDeducted = Number(confirmResult?.deductedAmount) || 0;
      const walletMessage =
        confirmDeducted > 0
          ? `Wallet deducted by ${formatCurrency(confirmDeducted)}. Ticket printed successfully.`
          : "Ticket printed successfully.";

      setTicketPreviewOpen(false);
      setActionSuccess(walletMessage);
    } catch (error) {
      if (holdTaken && !paperSent) {
        const aborted = await releasePrintHold();
        if (!aborted) {
          setSellError(
            `${error?.handled ? error.message : error?.message || "Failed to print ticket"}${heldStakeMessage}`,
          );
          setActionSuccess("");
          setTicketPreviewOpen(false);
          return;
        }
      }
      if (error?.handled) {
        setSellError(error.message);
      } else {
        setSellError(error?.message || "Failed to print ticket");
      }
      setActionSuccess("");
      setTicketPreviewOpen(false);
    } finally {
      printInFlightRef.current = false;
    }
  };

  const refreshPayoutTicket = async (ticket) => {
    const r = String(ticket?.receiptNumber || "").trim();
    if (!r) throw new Error("Receipt number missing on ticket");
    return lookupReceipt.mutateAsync(r);
  };

  const handleCancelTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    setCompletedAction(null);
    try {
      const response = await cancelTicket.mutateAsync(payoutTicket.id);
      setActionSuccess(response?.message || "Ticket canceled");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      setCompletedAction("cancel");
      await Promise.all([slipsQuery.refetch(), walletQuery.refetch()]);
    } catch (error) {
      setPayoutError(error?.message || "Failed to cancel ticket");
    }
  };

  const handlePayoutTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    setCompletedAction(null);
    try {
      const response = await payoutTicketMutation.mutateAsync({
        ticketId: payoutTicket.id,
      });
      setActionSuccess(response?.message || "Ticket payout completed");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      setCompletedAction("payout");
      await slipsQuery.refetch();
    } catch (error) {
      setPayoutError(error?.message || "Failed to payout ticket");
    }
  };

  const handlePayCashbackTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    setCompletedAction(null);
    try {
      const response = await payCashbackMutation.mutateAsync({
        ticketId: payoutTicket.id,
      });
      setActionSuccess(response?.message || "Cashback payout completed");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      setPayoutQuote(response?.quote || null);
      setCompletedAction("cashback");
      await Promise.all([slipsQuery.refetch(), walletQuery.refetch()]);
    } catch (error) {
      setPayoutError(error?.message || "Failed to pay cashback");
    }
  };

  const handlePrintActionReceipt = async (type) => {
    if (!payoutTicket) return;
    setPayoutError("");

    if (!printerConnected) {
      setPayoutError(
        "Printer offline. Ensure local print service is running and POS80 printer is connected.",
      );
      return;
    }

    try {
      const escposData = await encodeActionReceiptAsync(payoutTicket, {
        width: "80mm",
        type,
        amount:
          type === "cashback" ? toNumber(payoutQuote?.amount) : undefined,
      });
      const localPrintResult = await printViaLocalService(escposData);
      if (localPrintResult.success) {
        setActionSuccess(
          type === "payout"
            ? "Payout receipt printed."
            : type === "cashback"
              ? "Cashback receipt printed."
              : "Cancellation receipt printed.",
        );
        return;
      }

      const localError = String(
        localPrintResult.error?.message ||
          "Failed to send receipt to local printer service.",
      );
      if (localPrintResult.code === "service_unreachable") {
        setPayoutError(
          "Local print service unreachable. Start PrinterBridge.exe on this PC.",
        );
      } else if (localPrintResult.code === "com_unavailable") {
        setPayoutError(
          "Printer queue unavailable. Check POS80 is installed in Windows Print queues.",
        );
      } else {
        setPayoutError(localError);
      }
    } catch (error) {
      setPayoutError(error?.message || "Failed to print receipt");
    }
  };

  const handleCashoutTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    try {
      const response = await executeCashoutMutation.mutateAsync(
        payoutTicket.id,
      );
      setActionSuccess(response?.message || "Ticket cashout completed");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      setPayoutQuote(response?.quote || null);
      await slipsQuery.refetch();
    } catch (error) {
      setPayoutError(error?.message || "Failed to cash out ticket");
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadQuote() {
      if (
        (payoutAction !== "cashout" && payoutAction !== "cashback") ||
        !payoutTicket?.id
      ) {
        return;
      }
      try {
        const payload =
          payoutAction === "cashback"
            ? await cashbackQuoteMutation.mutateAsync(payoutTicket.id)
            : await cashoutQuoteMutation.mutateAsync(payoutTicket.id);
        if (!cancelled) {
          setPayoutQuote(payload?.quote || null);
        }
      } catch (error) {
        if (!cancelled) {
          setPayoutQuote(null);
          setPayoutError(
            error?.message ||
              (payoutAction === "cashback"
                ? "Failed to load cashback quote"
                : "Failed to load cashout quote"),
          );
        }
      }
    }
    void loadQuote();
    return () => {
      cancelled = true;
    };
  }, [payoutAction, payoutTicket?.id]);

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Cashier Tickets</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Sell tickets, process payout/cancel, and monitor today slips.
        </p>
      </div>

      <PanelCard className="mb-4 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Current Cashier Balance
        </p>
        <p className="mt-1 text-2xl font-bold">
          {cashierBalance == null ? (
            <span className="text-sm font-normal text-[var(--muted)]">
              Loading balance...
            </span>
          ) : (
            <>
              {toNumber(cashierBalance).toLocaleString()}{" "}
              <span className="text-sm font-normal text-[var(--muted)]">
                ETB
              </span>
            </>
          )}
        </p>
      </PanelCard>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-2 text-sm">
        <span className="font-semibold text-[var(--muted)]">Printer:</span>
        {printerConnected ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Printer Connected
              {printerPort ? (
                <span className="text-xs text-[var(--muted)]">({printerPort})</span>
              ) : null}
            </span>
            {printerQueueActive ? (
              <span className="text-xs text-[var(--muted)]">
                Printing…
                {printerQueueLength > 0
                  ? ` (${printerQueueLength} queued)`
                  : ""}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void testPrint()}
              className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--surface)]"
            >
              Test Print
            </button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-[var(--muted)]">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              Printer Offline
              {printerPort ? (
                <span className="text-xs">({printerPort})</span>
              ) : null}
            </span>
            {printerLastError ? (
              <span className="text-xs text-[var(--muted)]">{printerLastError}</span>
            ) : null}
          </>
        )}
        <button
          type="button"
          onClick={() => void refreshPrinterStatus()}
          className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
        >
          Refresh
        </button>
        {printError && (
          <span className="text-xs text-[var(--danger)]">{printError}</span>
        )}
      </div>

      {actionSuccess && (
        <div className="mb-4 rounded-sm border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <PanelCard className="p-0">
            <div className="flex border-b border-[var(--border)]">
              {LEFT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLeftTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-semibold ${
                    leftTab === tab.id
                      ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {leftTab === "sell" ? (
              <div className="p-4">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!isBusy) void handleCouponLookup("sell");
                  }}
                >
                  <input
                    type="text"
                    value={sellCouponInput}
                    onChange={(event) =>
                      setSellCouponInput(formatCouponInput(event.target.value))
                    }
                    placeholder="Enter Coupon ID"
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                    disabled={isBusy}
                  >
                    Search
                  </button>
                </form>

                {sellError && (
                  <p className="mt-3 text-xs text-[var(--danger)]">
                    {sellError}
                  </p>
                )}

                {sellTicket && (
                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Edit Stake (ETB)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sellStakeInput}
                        onChange={(event) =>
                          setSellStakeInput(event.target.value)
                        }
                        disabled={sellConfirmed || isBusy}
                        className="w-40 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSellConfirm}
                      disabled={
                        isBusy ||
                        sellConfirmed ||
                        hasInvalidLegs ||
                        insufficientFloat
                      }
                      className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {updateStake.isPending ? "Saving..." : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSellTicket(null);
                        setSellStakeInput("");
                        setSellConfirmed(false);
                        setTicketPreviewOpen(false);
                      }}
                      className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
                    >
                      Cancel
                    </button>
                    {sellConfirmed && (
                      <PrimaryButton
                        className="w-auto"
                        onClick={handlePrint}
                        disabled={isBusy}
                      >
                        Print Ticket
                      </PrimaryButton>
                    )}
                  </div>
                )}

                {!sellTicket ? (
                  <div className="mt-4 rounded-sm border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted)]">
                    Please provide valid ticket number.
                  </div>
                ) : (
                  <>
                    <TicketDetail
                      ticket={sellTicket}
                      platformWinningsTax={platformWinningsTax}
                      highlightInvalid
                      invalidSelectionIds={invalidSelectionIds}
                      blockingLegs={sellBlockingQuery.data?.blockingLegs || []}
                      onRemoveSelection={handleRemoveSelection}
                      removeDisabled={sellConfirmed || onlyOneLeg}
                      removingSelectionId={removingSelectionId}
                    />

                    {hasInvalidLegs ? (
                      <p className="mt-2 text-xs font-medium text-[#b91c1c]">
                        Remove expired or invalid selections before confirming.
                      </p>
                    ) : null}

                    {insufficientFloat ? (
                      <p className="mt-2 text-xs font-medium text-[#b91c1c]">
                        {INSUFFICIENT_CASHIER_BALANCE_MESSAGE}
                      </p>
                    ) : null}

                    <div className="mt-4 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-3">
                      {sellShowTax ? (
                        <div className="min-w-0 space-y-1 text-xs">
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--muted)]">Gross win</span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatCurrency(sellTaxBreakdown.gross)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--muted)]">
                              {sellTicket
                                ? formatTaxLineLabel(
                                    sellTicket,
                                    platformWinningsTax,
                                  )
                                : "Tax"}
                            </span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatCurrency(sellTaxBreakdown.tax)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-1">
                            <span className="font-semibold text-[var(--muted)]">
                              Net payout
                            </span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatCurrency(sellTaxBreakdown.net)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">
                          Possible Win:{" "}
                          <span className="font-semibold text-[var(--foreground)]">
                            {formatCurrency(sellCappedPossibleWin)}
                          </span>
                        </span>
                      )}
                      {sellConfirmed && (
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          Stake is locked once the ticket is confirmed.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-4">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!isBusy) void handleCouponLookup("payout");
                  }}
                >
                  <select
                    value={payoutAction}
                    onChange={(event) => {
                      setPayoutAction(event.target.value);
                      setPayoutQuote(null);
                      setCompletedAction(null);
                    }}
                    disabled={isBusy}
                    className="min-w-[8.5rem] rounded-sm border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  >
                    <option value="payout" className="bg-slate-900 text-white">
                      Payout
                    </option>
                    <option
                      value="cashback"
                      className="bg-slate-900 text-white"
                    >
                      Pay Cashback
                    </option>
                    <option value="cancel" className="bg-slate-900 text-white">
                      Cancel
                    </option>
                    <option value="cashout" className="bg-slate-900 text-white">
                      Cash Out
                    </option>
                  </select>
                  <input
                    type="text"
                    value={payoutReceiptInput}
                    onChange={(event) =>
                      setPayoutReceiptInput(
                        formatCouponInput(event.target.value),
                      )
                    }
                    placeholder="Receipt #####-#####"
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                    disabled={isBusy}
                  >
                    Search
                  </button>
                </form>

                {payoutError && (
                  <p className="mt-3 text-xs text-[var(--danger)]">
                    {payoutError}
                  </p>
                )}

                {!payoutTicket ? (
                  <div className="mt-4 rounded-sm border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted)]">
                    Please provide valid receipt number.
                  </div>
                ) : (
                  <>
                    <TicketDetail
                      ticket={payoutTicket}
                      platformWinningsTax={platformWinningsTax}
                      highlightSelections={payoutAction === "payout"}
                    />

                    <div className="mt-4 flex flex-wrap items-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (payoutAction === "payout") {
                            void handlePayoutTicket();
                          } else if (payoutAction === "cashback") {
                            void handlePayCashbackTicket();
                          } else if (payoutAction === "cancel") {
                            void handleCancelTicket();
                          } else if (payoutAction === "cashout") {
                            void handleCashoutTicket();
                          }
                        }}
                        disabled={
                          isBusy ||
                          ((payoutAction === "cashout" ||
                            payoutAction === "cashback") &&
                            payoutQuote &&
                            !payoutQuote.allowed)
                        }
                        className={`rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                          payoutAction === "cancel"
                            ? "bg-red-500"
                            : "bg-[var(--accent)]"
                        }`}
                      >
                        {payoutAction === "cancel"
                          ? "Cancel Ticket"
                          : payoutAction === "cashout"
                            ? "Execute Cash Out"
                            : payoutAction === "cashback"
                              ? "Pay Cashback"
                              : "Pay Winner"}
                      </button>

                      {(completedAction === "payout" ||
                        completedAction === "cancel" ||
                        completedAction === "cashback") && (
                        <button
                          type="button"
                          onClick={() =>
                            void handlePrintActionReceipt(completedAction)
                          }
                          disabled={isBusy}
                          className="rounded-sm border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-60"
                        >
                          {completedAction === "payout"
                            ? "Print Payout Receipt"
                            : completedAction === "cashback"
                              ? "Print Cashback Receipt"
                              : "Print Cancel Receipt"}
                        </button>
                      )}
                    </div>

                    {payoutAction === "cashout" && payoutQuote && (
                      <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-3 text-xs">
                        <p>
                          Cashout amount:{" "}
                          <span className="font-semibold">
                            {formatCurrency(payoutQuote.amount)}
                          </span>
                        </p>
                        <p className="mt-1 text-[var(--muted)]">
                          Won odds:{" "}
                          {toNumber(payoutQuote.breakdown?.currentOdds).toFixed(
                            2,
                          )}{" "}
                          | Margin:{" "}
                          {toNumber(payoutQuote.breakdown?.margin).toFixed(3)}
                        </p>
                        {!payoutQuote.allowed && (
                          <p className="mt-1 text-[var(--danger)]">
                            Not eligible (
                            {payoutQuote.reasonCode || "unavailable"}).
                          </p>
                        )}
                      </div>
                    )}

                    {payoutAction === "cashback" && payoutQuote && (
                      <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-3 text-xs">
                        <p>
                          Cashback amount:{" "}
                          <span className="font-semibold">
                            {formatCurrency(payoutQuote.amount)}
                          </span>
                        </p>
                        {payoutQuote.profileKey && (
                          <p className="mt-1 text-[var(--muted)]">
                            Profile:{" "}
                            {CASHBACK_PROFILE_LABELS[payoutQuote.profileKey] ||
                              payoutQuote.profileKey}
                          </p>
                        )}
                        {payoutQuote.result != null && (
                          <p className="mt-1 text-[var(--muted)]">
                            Result ratio:{" "}
                            {toNumber(payoutQuote.result).toFixed(2)}
                            {payoutQuote.tier?.stakeMultiplier != null && (
                              <>
                                {" "}
                                | Tier ×{payoutQuote.tier.stakeMultiplier}
                              </>
                            )}
                          </p>
                        )}
                        {!payoutQuote.allowed && (
                          <p className="mt-1 text-[var(--danger)]">
                            Not eligible (
                            {cashbackReasonLabel(payoutQuote.reasonCode)}).
                          </p>
                        )}
                      </div>
                    )}

                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      Current status:{" "}
                      <span className="font-mono">{payoutTicket.status}</span>
                      {payoutAction === "payout" &&
                        payoutTicket.status !== "WON" && (
                          <>
                            {" "}
                            &middot; Payout is only available for WON tickets.
                          </>
                        )}
                      {payoutAction === "cashback" &&
                        payoutTicket.status !== "LOST" && (
                          <>
                            {" "}
                            &middot; Cashback is only available for LOST printed
                            tickets.
                          </>
                        )}
                      {payoutAction === "cancel" &&
                        payoutTicket.status !== "OPEN" &&
                        payoutTicket.status !== "PRINTED" && (
                          <>
                            {" "}
                            &middot; Cancel is only available for OPEN or
                            PRINTED (sold) tickets.
                          </>
                        )}
                      {payoutAction === "cashout" && (
                        <>
                          {" "}
                          &middot; Cashout value is calculated by the server and
                          cannot be edited.
                        </>
                      )}
                      {payoutAction === "cashback" &&
                        payoutTicket.status === "LOST" && (
                          <>
                            {" "}
                            &middot; Cashback eligibility is calculated at claim
                            time and cannot be edited.
                          </>
                        )}
                    </p>
                  </>
                )}
              </div>
            )}
          </PanelCard>
        </div>

        <div className="space-y-4">
          <PanelCard className="p-0">
            <div className="bg-[#04113d] px-3 py-3 text-xs font-semibold text-white">
              Click the button below to launch the game fixtures
              <div className="mt-2">
                <button
                  type="button"
                  className="rounded-sm border border-blue-400 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Launch Fixtures
                </button>
              </div>
            </div>
            <div className="border-t border-[var(--border)] px-3 py-3">
              <h3 className="text-2xl font-semibold">Today Slips</h3>
              <div className="mt-2 flex border-b border-[var(--border)]">
                {RIGHT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setRightTab(tab.id);
                      setSlipsPage(1);
                    }}
                    className={`relative px-3 py-2 text-xs font-semibold ${
                      rightTab === tab.id
                        ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {tab.label}
                    {tab.id === "inbox" && inboxUnread > 0 ? (
                      <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 py-0.5 text-[10px] font-bold text-white">
                        {inboxUnread > 99 ? "99+" : inboxUnread}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {rightTab === "inbox" ? (
                <CashierInboxList />
              ) : (
                <div className="mt-3">
                  {!slipsEnabled ||
                  !slipsQuery.isFetching ||
                  slipsData.length > 0 ? null : (
                    <p className="mb-2 text-xs text-[var(--muted)]">
                      Loading slips...
                    </p>
                  )}
                  <SlipsTable
                    items={slipsData}
                    page={slipsPage}
                    totalPages={totalPages}
                    onPageChange={setSlipsPage}
                  />
                </div>
              )}
            </div>
          </PanelCard>
        </div>
      </div>


      <Modal
        open={ticketPreviewOpen}
        onClose={() => setTicketPreviewOpen(false)}
        title="Ticket Preview"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            Confirm the ticket layout below, then download the PDF for printing.
          </p>
          <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-[var(--border)] bg-[#f2f2f2] p-3">
            {ticketForPrint ? (
              <TicketTemplate
                ticket={ticketForPrint}
                barcodeDataUrl={barcodeDataUrl}
                width="80mm"
                platformWinningsTax={platformWinningsTax}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No ticket available for preview.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setTicketPreviewOpen(false)}
              className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={pdfBusy || !ticketForPrint}
              onClick={async () => {
                const ok = await downloadPdf();
                if (ok) {
                  setActionSuccess("Ticket PDF downloaded. Print it directly.");
                } else {
                  setSellError("Failed to generate ticket PDF");
                }
              }}
              className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pdfBusy ? "Generating PDF..." : "Download PDF"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="thermal-print-area" aria-hidden>
        {ticketForPrint && (
          <TicketTemplate
            ref={ticketRef}
            ticket={ticketForPrint}
            barcodeDataUrl={barcodeDataUrl}
            width="80mm"
            platformWinningsTax={platformWinningsTax}
          />
        )}
      </div>
    </AdminShell>
  );
}
