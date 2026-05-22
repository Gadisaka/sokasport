/**
 * Cashier dashboard aggregates — date range, scoped to logged-in cashier.
 * Jackpot-style tickets are excluded when `selection_snapshot` marks them (no jackpot model yet).
 *
 * @module controllers/cashierDashboardController
 */
import { prisma } from "../Config/db.js";

function parseDateOnlyStart(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateOnlyEnd(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** @param {{ selection_snapshot?: unknown }} ticket */
function isJackpotTicket(ticket) {
  const snap = ticket.selection_snapshot;
  if (snap == null) return false;
  if (typeof snap === "object" && !Array.isArray(snap)) {
    if (snap.isJackpot === true) return true;
    if (snap.gameMode === "jackpot" || snap.type === "jackpot") return true;
    if (snap.product === "jackpot") return true;
  }
  return false;
}

async function resolveCashierByUserId(userId) {
  if (!userId) return null;
  return prisma.cashier.findUnique({
    where: { user_id: userId },
  });
}

/**
 * GET /api/cashier/wallet/dashboard-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Cashier-only. Uses local calendar-day bounds for `from` / `to`.
 */
export async function getCashierDashboardStats(req, res) {
  try {
    if (req.user.role !== "CASHIER") {
      return res.status(403).json({ message: "Cashier only" });
    }

    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return res.status(404).json({
        message:
          "Cashier profile not found. Ask admin to create this cashier in Agents & Cashiers.",
      });
    }

    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const defaultTo = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const from =
      typeof fromRaw === "string" && fromRaw.trim()
        ? parseDateOnlyStart(fromRaw)
        : defaultFrom;
    const to =
      typeof toRaw === "string" && toRaw.trim() ? parseDateOnlyEnd(toRaw) : defaultTo;

    if (!from || !to || from > to) {
      return res.status(400).json({ message: "Valid from and to dates (YYYY-MM-DD) are required" });
    }

    const walletId = cashier.wallet_id;

    // --- Sold (print-confirmed stakes): BET ticket-print:* — cashier float charged at print ---
    const betTxs = await prisma.transaction.findMany({
      where: {
        wallet_id: walletId,
        type: "BET",
        reference: { startsWith: "ticket-print:" },
        created_at: { gte: from, lte: to },
      },
    });

    const betTicketIds = betTxs
      .map((tx) => {
        const ref = String(tx.reference || "");
        return ref.startsWith("ticket-print:") ? ref.slice("ticket-print:".length) : null;
      })
      .filter(Boolean);

    const betTickets =
      betTicketIds.length > 0
        ? await prisma.ticket.findMany({
            where: { id: { in: betTicketIds } },
            select: { id: true, selection_snapshot: true },
          })
        : [];

    const jackpotSoldIds = new Set(
      betTickets.filter((t) => isJackpotTicket(t)).map((t) => t.id),
    );

    const soldBets = betTxs.filter((tx) => {
      const ref = String(tx.reference || "");
      const tid = ref.startsWith("ticket-print:") ? ref.slice("ticket-print:".length) : "";
      return tid && !jackpotSoldIds.has(tid);
    });

    const totalTicketsSold = soldBets.length;
    const totalSoldPrice = soldBets.reduce((s, tx) => s + Number(tx.amount), 0);

    // --- Paid winning tickets: PAYOUT ticket:* ---
    const payoutTxs = await prisma.transaction.findMany({
      where: {
        wallet_id: walletId,
        type: "PAYOUT",
        reference: { startsWith: "ticket:" },
        created_at: { gte: from, lte: to },
      },
    });

    const payoutTicketIds = payoutTxs
      .map((tx) => {
        const ref = String(tx.reference || "");
        return ref.startsWith("ticket:") ? ref.slice("ticket:".length) : null;
      })
      .filter(Boolean);

    const payoutTickets =
      payoutTicketIds.length > 0
        ? await prisma.ticket.findMany({
            where: { id: { in: payoutTicketIds } },
            select: { id: true, selection_snapshot: true },
          })
        : [];

    const jackpotPaidIds = new Set(
      payoutTickets.filter((t) => isJackpotTicket(t)).map((t) => t.id),
    );

    const payoutsNonJackpot = payoutTxs.filter((tx) => {
      const ref = String(tx.reference || "");
      const tid = ref.startsWith("ticket:") ? ref.slice("ticket:".length) : "";
      return tid && !jackpotPaidIds.has(tid);
    });

    const totalPaidTickets = payoutsNonJackpot.length;
    const totalPaidAmount = payoutsNonJackpot.reduce((s, tx) => s + Number(tx.amount), 0);

    // --- Player wallet: cashier deposited (WITHDRAW on cashier) ---
    const depositTxs = await prisma.transaction.findMany({
      where: {
        wallet_id: walletId,
        type: "WITHDRAW",
        created_at: { gte: from, lte: to },
        reference: { startsWith: "cashier-deposit:" },
      },
    });
    const totalDepositAmount = depositTxs.reduce((s, tx) => s + Number(tx.amount), 0);

    // --- Player withdraw approved into cashier float (DEPOSIT on cashier) ---
    const withdrawTxs = await prisma.transaction.findMany({
      where: {
        wallet_id: walletId,
        type: "DEPOSIT",
        created_at: { gte: from, lte: to },
        reference: { startsWith: "cashier-withdraw-approve:" },
      },
    });
    const totalWithdrawAmount = withdrawTxs.reduce((s, tx) => s + Number(tx.amount), 0);

    const grandNet =
      totalSoldPrice -
      totalPaidAmount -
      totalDepositAmount +
      totalWithdrawAmount;

    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      totalTicketsSold,
      totalSoldPrice,
      totalDepositAmount,
      totalWithdrawAmount,
      totalPaidTickets,
      totalPaidAmount,
      grandNet,
    });
  } catch (error) {
    console.error("getCashierDashboardStats error:", error);
    return res.status(500).json({ message: "Failed to load dashboard stats" });
  }
}
