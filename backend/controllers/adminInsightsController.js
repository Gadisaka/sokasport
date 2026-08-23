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

function getDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

/**
 * GET /api/admin/insights/dashboard
 * Real-time operations insights for SUPER_ADMIN / ADMIN.
 */
export async function getAdminDashboardInsights(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);

    const chartEnd = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999),
    );
    const chartStart = new Date(chartEnd);
    chartStart.setUTCDate(chartStart.getUTCDate() - 6);
    chartStart.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      newUsersInRange,
      activeCashiers,
      activeAgents,
      ticketsInRange,
      paidTicketsInRange,
      chartTickets,
      recentTicketsRaw,
      payoutInRange,
      chartPayouts,
      playerWalletInRange,
      pendingWithdrawals,
      recentWalletRaw,
      recentAdminRaw,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: true } }),
      prisma.user.count({ where: { created_at: { gte: start, lte: end } } }),
      prisma.user.count({ where: { status: true, role: { name: "CASHIER" } } }),
      prisma.user.count({ where: { status: true, role: { name: "AGENT" } } }),
      prisma.ticket.findMany({
        where: { created_at: { gte: start, lte: end } },
        select: {
          id: true,
          coupon_number: true,
          created_at: true,
          stake: true,
          potential_win: true,
          status: true,
          branch_name: true,
          branch_location: true,
        },
      }),
      prisma.ticket.count({
        where: {
          paid_at: { gte: start, lte: end },
          status: "PAID",
        },
      }),
      prisma.ticket.findMany({
        where: { created_at: { gte: chartStart, lte: chartEnd } },
        select: { created_at: true, stake: true },
      }),
      prisma.ticket.findMany({
        where: { created_at: { gte: start, lte: end } },
        include: {
          cashier: { include: { user: { select: { fullname: true } } } },
          user: { select: { fullname: true } },
        },
        orderBy: { created_at: "desc" },
        take: 15,
      }),
      prisma.transaction.aggregate({
        where: { type: "PAYOUT", created_at: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.findMany({
        where: { type: "PAYOUT", created_at: { gte: chartStart, lte: chartEnd } },
        select: { amount: true, created_at: true },
      }),
      prisma.transaction.findMany({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: { in: ["DEPOSIT", "WITHDRAW"] },
          created_at: { gte: start, lte: end },
        },
        select: { type: true, amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: "WITHDRAW",
          reference: { startsWith: "pending:withdraw:" },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.findMany({
        where: {
          wallet: { wallet_type: "PLAYER" },
          type: { in: ["DEPOSIT", "WITHDRAW"] },
        },
        include: {
          wallet: {
            include: {
              user: {
                select: {
                  fullname: true,
                  role: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: 15,
      }),
      prisma.auditLog.findMany({
        orderBy: { created_at: "desc" },
        include: { user: { select: { fullname: true } } },
        take: 12,
      }),
    ]);

    const statusCounts = {
      OPEN: 0,
      PRINTED: 0,
      WON: 0,
      LOST: 0,
      VOID: 0,
      CANCELED: 0,
      PAID: 0,
      CASHED_OUT: 0,
      CASHBACK_PAID: 0,
    };
    let totalStake = 0;
    let totalPotentialWin = 0;
    const branchMap = new Map();

    for (const ticket of ticketsInRange) {
      const stake = Number(ticket.stake || 0);
      const potentialWin = Number(ticket.potential_win || 0);
      totalStake += stake;
      totalPotentialWin += potentialWin;
      if (statusCounts[ticket.status] !== undefined) {
        statusCounts[ticket.status] += 1;
      }

      const branchKey = `${ticket.branch_name}:::${ticket.branch_location}`;
      if (!branchMap.has(branchKey)) {
        branchMap.set(branchKey, {
          branchName: ticket.branch_name || "Unknown",
          branchLocation: ticket.branch_location || "",
          tickets: 0,
          stake: 0,
        });
      }
      const row = branchMap.get(branchKey);
      row.tickets += 1;
      row.stake += stake;
    }

    const ticketVolumeMap = new Map();
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(chartStart.getTime());
      d.setUTCDate(d.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      ticketVolumeMap.set(ymd, {
        date: ymd,
        day: getDayLabel(d),
        tickets: 0,
        stake: 0,
        payouts: 0,
        profit: 0,
      });
    }

    for (const ticket of chartTickets) {
      const ymd = ticket.created_at.toISOString().slice(0, 10);
      const bucket = ticketVolumeMap.get(ymd);
      if (!bucket) continue;
      bucket.tickets += 1;
      bucket.stake += Number(ticket.stake || 0);
    }

    for (const tx of chartPayouts) {
      const ymd = tx.created_at.toISOString().slice(0, 10);
      const bucket = ticketVolumeMap.get(ymd);
      if (!bucket) continue;
      bucket.payouts += Number(tx.amount || 0);
    }

    const ticketVolumeLast7Days = [...ticketVolumeMap.values()].map((item) => ({
      ...item,
      profit: item.stake - item.payouts,
    }));

    let depositsAmount = 0;
    let withdrawalsAmount = 0;
    for (const tx of playerWalletInRange) {
      const amount = Number(tx.amount || 0);
      if (tx.type === "DEPOSIT") depositsAmount += amount;
      if (tx.type === "WITHDRAW") withdrawalsAmount += amount;
    }

    const totalPayout = Number(payoutInRange._sum.amount || 0);
    const byStatus = Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
    }));
    const topBranches = [...branchMap.values()]
      .sort((a, b) => b.stake - a.stake)
      .slice(0, 10);

    const recentTickets = recentTicketsRaw.map((ticket) => ({
      id: ticket.id,
      couponNumber: ticket.coupon_number,
      createdAt: ticket.created_at,
      stake: Number(ticket.stake || 0),
      potentialWin: Number(ticket.potential_win || 0),
      status: ticket.status,
      branchName: ticket.branch_name,
      branchLocation: ticket.branch_location,
      cashierName: ticket.cashier?.user?.fullname || "",
      playerName: ticket.user?.fullname || "",
    }));

    const recentWalletActivity = recentWalletRaw.map((tx) => ({
      id: tx.id,
      createdAt: tx.created_at,
      type: tx.type,
      amount: Number(tx.amount || 0),
      walletType: tx.wallet?.wallet_type || "",
      userName: tx.wallet?.user?.fullname || "Unknown",
      userRole: tx.wallet?.user?.role?.name || "",
      reference: tx.reference || "",
    }));

    const recentAdminActivity = recentAdminRaw.map((log) => ({
      id: log.id,
      createdAt: log.created_at,
      actorName: log.user?.fullname || "System",
      actorRole: log.actor_role || "",
      action: log.action,
      module: log.module,
    }));

    const summary = {
      totalUsers,
      activeUsers,
      newUsersInRange,
      activeCashiers,
      activeAgents,
      totalTickets: ticketsInRange.length,
      openTickets: statusCounts.OPEN + statusCounts.PRINTED,
      paidTickets: paidTicketsInRange,
      settledTickets:
        statusCounts.WON +
        statusCounts.LOST +
        statusCounts.VOID +
        statusCounts.CANCELED +
        statusCounts.PAID +
        statusCounts.CASHED_OUT +
        statusCounts.CASHBACK_PAID,
      totalStake,
      totalPotentialWin,
      totalPayout,
      platformProfit: totalStake - totalPayout,
      payoutCount: Number(payoutInRange._count._all || 0),
      depositsAmount,
      withdrawalsAmount,
      pendingWithdrawalsAmount: Number(pendingWithdrawals._sum.amount || 0),
      pendingWithdrawalsCount: Number(pendingWithdrawals._count._all || 0),
      netCashFlow: depositsAmount - withdrawalsAmount,
    };

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      summary,
      ticketVolumeLast7Days,
      byStatus,
      topBranches,
      recentTickets,
      recentWalletActivity,
      recentAdminActivity,
    });
  } catch (error) {
    console.error("getAdminDashboardInsights error:", error);
    return res.status(500).json({ message: "Failed to load admin dashboard insights" });
  }
}
