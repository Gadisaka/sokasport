/**
 * Casino (InOut) reports controller.
 *
 * Aggregates wallet transactions tagged with `inout:*` references to show
 * casino GGR and activity metrics for admins.
 *
 * Transaction reference patterns:
 *   inout:bet:{id}      → BET    (stake debit)
 *   inout:withdraw:{id} → PAYOUT (win credit)
 *   inout:rollback:{id} → PAYOUT (refund credit)
 *
 * @module controllers/casinoReportsController
 */
import { prisma } from "../Config/db.js";

function parseDateYmd(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateRangeFromQuery(query) {
  const from = parseDateYmd(query.from);
  const to = parseDateYmd(query.to);

  if (!from && !to) {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );
    return { start, end };
  }

  const base = new Date();
  const start = from
    ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0))
    : new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  const end = to
    ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999))
    : new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 59, 59, 999));

  return { start, end };
}

function getDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

const MAX_REPORT_RANGE_DAYS = 93;

function diffUtcDaysInclusive(start, end) {
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * GET /api/admin/casino/reports
 * Query: from, to (YYYY-MM-DD), max ~93 days.
 */
export async function getCasinoReports(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);
    const daySpan = diffUtcDaysInclusive(start, end);
    if (daySpan > MAX_REPORT_RANGE_DAYS) {
      return res.status(400).json({
        message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
      });
    }

    // Fetch all casino transactions in the date range
    const transactions = await prisma.transaction.findMany({
      where: {
        created_at: { gte: start, lte: end },
        reference: { startsWith: "inout:" },
      },
      select: {
        id: true,
        wallet_id: true,
        type: true,
        amount: true,
        reference: true,
        created_at: true,
        wallet: {
          select: {
            user_id: true,
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    // Categorize transactions
    const bets = transactions.filter((t) => t.reference?.startsWith("inout:bet:"));
    const withdraws = transactions.filter((t) => t.reference?.startsWith("inout:withdraw:"));
    const rollbacks = transactions.filter((t) => t.reference?.startsWith("inout:rollback:"));

    const totalBets = bets.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWins = withdraws.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalRollbacks = rollbacks.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const ggr = totalBets - totalWins - totalRollbacks;

    // Unique players (by user_id)
    const playerIds = new Set(transactions.map((t) => t.wallet?.user_id).filter(Boolean));

    // Daily breakdown
    const dailyMap = new Map();
    for (let i = 0; i < daySpan; i += 1) {
      const d = new Date(start.getTime());
      d.setUTCDate(d.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      dailyMap.set(ymd, {
        date: ymd,
        dayLabel: getDayLabel(d),
        bets: 0,
        betAmount: 0,
        wins: 0,
        winAmount: 0,
        rollbacks: 0,
        rollbackAmount: 0,
        ggr: 0,
        uniquePlayers: new Set(),
      });
    }

    for (const t of transactions) {
      const ymd = t.created_at.toISOString().slice(0, 10);
      const dayRow = dailyMap.get(ymd);
      if (!dayRow) continue;

      const amount = Number(t.amount || 0);
      const userId = t.wallet?.user_id;

      if (t.reference?.startsWith("inout:bet:")) {
        dayRow.bets += 1;
        dayRow.betAmount += amount;
      } else if (t.reference?.startsWith("inout:withdraw:")) {
        dayRow.wins += 1;
        dayRow.winAmount += amount;
      } else if (t.reference?.startsWith("inout:rollback:")) {
        dayRow.rollbacks += 1;
        dayRow.rollbackAmount += amount;
      }

      if (userId) dayRow.uniquePlayers.add(userId);
    }

    // Finalize daily data
    const byDay = [...dailyMap.values()].map((d) => ({
      date: d.date,
      dayLabel: d.dayLabel,
      bets: d.bets,
      betAmount: d.betAmount,
      wins: d.wins,
      winAmount: d.winAmount,
      rollbacks: d.rollbacks,
      rollbackAmount: d.rollbackAmount,
      ggr: d.betAmount - d.winAmount - d.rollbackAmount,
      uniquePlayers: d.uniquePlayers.size,
    }));

    // Top players by volume (bet amount)
    const playerMap = new Map();
    for (const t of bets) {
      const userId = t.wallet?.user_id;
      if (!userId) continue;
      const user = t.wallet?.user;
      const entry = playerMap.get(userId) || {
        userId,
        name: user?.name || "Unknown",
        phone: user?.phone || null,
        bets: 0,
        betAmount: 0,
        winAmount: 0,
        rollbackAmount: 0,
      };
      entry.bets += 1;
      entry.betAmount += Number(t.amount || 0);
      playerMap.set(userId, entry);
    }
    for (const t of withdraws) {
      const userId = t.wallet?.user_id;
      if (!userId) continue;
      const entry = playerMap.get(userId);
      if (entry) {
        entry.winAmount += Number(t.amount || 0);
      }
    }
    for (const t of rollbacks) {
      const userId = t.wallet?.user_id;
      if (!userId) continue;
      const entry = playerMap.get(userId);
      if (entry) {
        entry.rollbackAmount += Number(t.amount || 0);
      }
    }

    const topPlayers = [...playerMap.values()]
      .map((p) => ({
        ...p,
        ggr: p.betAmount - p.winAmount - p.rollbackAmount,
      }))
      .sort((a, b) => b.betAmount - a.betAmount)
      .slice(0, 20);

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      summary: {
        totalBets: bets.length,
        totalBetAmount: totalBets,
        totalWins: withdraws.length,
        totalWinAmount: totalWins,
        totalRollbacks: rollbacks.length,
        totalRollbackAmount: totalRollbacks,
        ggr,
        uniquePlayers: playerIds.size,
      },
      byDay,
      topPlayers,
    });
  } catch (error) {
    console.error("getCasinoReports error:", error);
    return res.status(500).json({ message: "Failed to load casino reports" });
  }
}
