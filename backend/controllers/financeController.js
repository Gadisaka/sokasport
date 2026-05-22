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
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    return { start, end };
  }

  const base = new Date();
  const start = from
    ? new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0),
      )
    : new Date(
        Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth(),
          base.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
  const end = to
    ? new Date(
        Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999),
      )
    : new Date(
        Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth(),
          base.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );

  return { start, end };
}

function statusFromReference(reference) {
  const ref = String(reference || "");
  if (ref.startsWith("pending:")) return "PENDING";
  if (ref.startsWith("approved:")) return "APPROVED";
  if (ref.startsWith("rejected:")) return "REJECTED";
  if (ref.startsWith("held:")) return "HELD";
  return "COMPLETED";
}

function actionFromTransaction(tx) {
  const status = statusFromReference(tx.reference);
  if (status === "PENDING" && tx.type === "WITHDRAW") {
    return "Withdrawal request created";
  }
  if (status === "PENDING" && tx.type === "DEPOSIT") {
    return "Deposit request created";
  }
  if (status === "APPROVED") {
    return tx.type === "DEPOSIT" ? "Deposit approved" : "Withdrawal approved";
  }
  if (status === "REJECTED") {
    return tx.type === "DEPOSIT" ? "Deposit rejected" : "Withdrawal rejected";
  }
  if (status === "HELD") {
    return tx.type === "DEPOSIT" ? "Deposit held" : "Withdrawal held";
  }
  return tx.type === "DEPOSIT" ? "Deposit movement" : "Withdrawal movement";
}

function getDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export async function getFinancialSupportDashboard(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);

    const chartEnd = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999),
    );
    const chartStart = new Date(chartEnd);
    chartStart.setUTCDate(chartStart.getUTCDate() - 6);
    chartStart.setUTCHours(0, 0, 0, 0);

    const [rangeTransactions, chartTransactions, pendingRows] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: { in: ["DEPOSIT", "WITHDRAW"] },
          created_at: { gte: start, lte: end },
        },
        include: {
          wallet: {
            include: { user: { select: { id: true, name: true, phone: true } } },
          },
        },
        orderBy: { created_at: "desc" },
      }),
      prisma.transaction.findMany({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: { in: ["DEPOSIT", "WITHDRAW"] },
          created_at: { gte: chartStart, lte: chartEnd },
        },
        select: { type: true, amount: true, created_at: true },
      }),
      prisma.transaction.findMany({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: "WITHDRAW",
          reference: { startsWith: "pending:withdraw:" },
        },
        include: {
          wallet: {
            include: { user: { select: { id: true, name: true, phone: true } } },
          },
        },
        orderBy: { created_at: "desc" },
        take: 20,
      }),
    ]);

    const summary = {
      depositsAmount: 0,
      depositsCount: 0,
      withdrawalsAmount: 0,
      withdrawalsCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      heldCount: 0,
      netCashFlow: 0,
      pendingWithdrawalsAmount: pendingRows.reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0,
      ),
      pendingWithdrawalsCount: pendingRows.length,
    };

    for (const tx of rangeTransactions) {
      const amount = Number(tx.amount || 0);
      const status = statusFromReference(tx.reference);
      if (tx.type === "DEPOSIT") {
        summary.depositsAmount += amount;
        summary.depositsCount += 1;
      } else if (tx.type === "WITHDRAW") {
        summary.withdrawalsAmount += amount;
        summary.withdrawalsCount += 1;
      }

      if (status === "APPROVED") summary.approvedCount += 1;
      if (status === "REJECTED") summary.rejectedCount += 1;
      if (status === "HELD") summary.heldCount += 1;
    }
    summary.netCashFlow = summary.depositsAmount - summary.withdrawalsAmount;

    const buckets = [];
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(chartStart);
      date.setUTCDate(chartStart.getUTCDate() + i);
      buckets.push({
        ymd: date.toISOString().slice(0, 10),
        day: getDayLabel(date),
        deposits: 0,
        withdrawals: 0,
      });
    }
    const bucketMap = new Map(buckets.map((item) => [item.ymd, item]));

    for (const tx of chartTransactions) {
      const ymd = tx.created_at.toISOString().slice(0, 10);
      const bucket = bucketMap.get(ymd);
      if (!bucket) continue;
      const amount = Number(tx.amount || 0);
      if (tx.type === "DEPOSIT") bucket.deposits += amount;
      if (tx.type === "WITHDRAW") bucket.withdrawals += amount;
    }

    const pendingWithdrawals = pendingRows.map((row) => ({
      id: row.id,
      userName: row.wallet?.user?.name || "Unknown",
      userPhone: row.wallet?.user?.phone || "",
      amount: Number(row.amount || 0),
      requestedAt: row.created_at,
      status: statusFromReference(row.reference),
    }));

    const recentActivity = rangeTransactions.slice(0, 20).map((tx) => ({
      id: tx.id,
      time: tx.created_at,
      userName: tx.wallet?.user?.name || "Unknown",
      userPhone: tx.wallet?.user?.phone || "",
      type: tx.type,
      amount: Number(tx.amount || 0),
      status: statusFromReference(tx.reference),
      action: actionFromTransaction(tx),
    }));

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      summary,
      cashflowLast7Days: buckets.map(({ day, deposits, withdrawals }) => ({
        day,
        deposits,
        withdrawals,
      })),
      pendingWithdrawals,
      recentActivity,
    });
  } catch (error) {
    console.error("getFinancialSupportDashboard error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load financial support dashboard" });
  }
}

const MAX_REPORT_RANGE_DAYS = 93;

function diffUtcDaysInclusive(start, end) {
  const a = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * GET /api/admin/finance/reports
 * Player-wallet deposit/withdraw aggregates for a date range (tabular reporting).
 * Query: from, to (YYYY-MM-DD), max ~93 days.
 * Guard: reports:read
 */
export async function getFinancialSupportReports(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);
    const daySpan = diffUtcDaysInclusive(start, end);
    if (daySpan > MAX_REPORT_RANGE_DAYS) {
      return res.status(400).json({
        message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
      });
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        wallet: { wallet_type: "PLAYER" },
        type: { in: ["DEPOSIT", "WITHDRAW"] },
        created_at: { gte: start, lte: end },
      },
      select: {
        type: true,
        amount: true,
        reference: true,
        created_at: true,
      },
    });

    const summary = {
      depositsAmount: 0,
      depositsCount: 0,
      withdrawalsAmount: 0,
      withdrawalsCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      heldCount: 0,
      completedCount: 0,
      netCashFlow: 0,
    };

    const dailyMap = new Map();

    for (let i = 0; i < daySpan; i += 1) {
      const d = new Date(start.getTime());
      d.setUTCDate(d.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      dailyMap.set(ymd, {
        date: ymd,
        dayLabel: getDayLabel(d),
        depositsAmount: 0,
        withdrawalsAmount: 0,
        depositsCount: 0,
        withdrawalsCount: 0,
        netCashFlow: 0,
      });
    }

    for (const tx of transactions) {
      const amount = Number(tx.amount || 0);
      const status = statusFromReference(tx.reference);
      const ymd = tx.created_at.toISOString().slice(0, 10);

      if (tx.type === "DEPOSIT") {
        summary.depositsAmount += amount;
        summary.depositsCount += 1;
      } else if (tx.type === "WITHDRAW") {
        summary.withdrawalsAmount += amount;
        summary.withdrawalsCount += 1;
      }

      if (status === "PENDING") summary.pendingCount += 1;
      else if (status === "APPROVED") summary.approvedCount += 1;
      else if (status === "REJECTED") summary.rejectedCount += 1;
      else if (status === "HELD") summary.heldCount += 1;
      else summary.completedCount += 1;

      const row = dailyMap.get(ymd);
      if (row) {
        if (tx.type === "DEPOSIT") {
          row.depositsAmount += amount;
          row.depositsCount += 1;
        }
        if (tx.type === "WITHDRAW") {
          row.withdrawalsAmount += amount;
          row.withdrawalsCount += 1;
        }
      }
    }

    summary.netCashFlow = summary.depositsAmount - summary.withdrawalsAmount;

    const byDay = [...dailyMap.values()].map((row) => ({
      ...row,
      netCashFlow: row.depositsAmount - row.withdrawalsAmount,
    }));

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      summary: {
        ...summary,
        transactionCount: transactions.length,
      },
      byDay,
    });
  } catch (error) {
    console.error("getFinancialSupportReports error:", error);
    return res.status(500).json({ message: "Failed to load financial reports" });
  }
}
