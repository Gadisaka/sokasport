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

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatHourLabel(date) {
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${hour}:00`;
}

function mapCashierStatus(active) {
  return active ? "ACTIVE" : "OFFLINE";
}

/** OPEN = not printed yet; PRINTED = sold, still awaiting match settlement */
function isUnsettledTicketStatus(status) {
  return status === "OPEN" || status === "PRINTED";
}

async function getAgentScope(agentUserId) {
  const assignments = await prisma.agentCashier.findMany({
    where: { agent_id: agentUserId },
    include: {
      cashier: {
        include: {
          user: {
            select: { id: true, fullname: true, status: true },
          },
          wallet: {
            select: { balance: true },
          },
        },
      },
    },
  });

  const cashiers = assignments
    .map((assignment) => assignment.cashier)
    .filter(Boolean);

  const cashierIds = cashiers.map((cashier) => cashier.id);

  return {
    cashiers,
    cashierIds,
  };
}

export async function getAgentCashiers(req, res) {
  try {
    const branchName = String(req.query.branchName || "").trim();
    const { start, end } = getDateRangeFromQuery(req.query);
    const { cashiers, cashierIds } = await getAgentScope(req.user.sub);

    if (cashierIds.length === 0) {
      return res.json({
        range: { from: start, to: end },
        branches: [],
        items: [],
      });
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        cashier_id: { in: cashierIds },
        created_at: { gte: start, lte: end },
        ...(branchName ? { branch_name: branchName } : {}),
      },
      select: {
        id: true,
        cashier_id: true,
        stake: true,
        status: true,
        branch_name: true,
      },
    });

    const statsByCashierId = new Map();
    const branchesSet = new Set();

    for (const ticket of tickets) {
      if (ticket.branch_name) branchesSet.add(ticket.branch_name);
      const current = statsByCashierId.get(ticket.cashier_id) || {
        tickets: 0,
        volume: 0,
        pending: 0,
      };
      current.tickets += 1;
      current.volume += Number(ticket.stake || 0);
      if (isUnsettledTicketStatus(ticket.status)) current.pending += 1;
      statsByCashierId.set(ticket.cashier_id, current);
    }

    for (const cashier of cashiers) {
      if (cashier.branch_name) branchesSet.add(cashier.branch_name);
    }

    const scopedCashiers = cashiers.filter(
      (cashier) => !branchName || cashier.branch_name === branchName,
    );

    const items = scopedCashiers.map((cashier) => {
      const stats = statsByCashierId.get(cashier.id) || {
        tickets: 0,
        volume: 0,
        pending: 0,
      };

      return {
        cashierProfileId: cashier.id,
        cashierId: cashier.user_id,
        cashierName: cashier.user?.fullname || "Cashier",
        branchName: cashier.branch_name || "Unknown",
        branchLocation: cashier.branch_location || "",
        status: mapCashierStatus(Boolean(cashier.user?.status)),
        walletBalance: Number(cashier.wallet?.balance || 0),
        tickets: stats.tickets,
        volume: stats.volume,
        pending: stats.pending,
      };
    });

    return res.json({
      range: { from: start, to: end },
      branches: [...branchesSet].sort((a, b) => a.localeCompare(b)),
      items,
    });
  } catch (error) {
    console.error("getAgentCashiers error:", error);
    return res.status(500).json({ message: "Failed to load agent cashiers" });
  }
}

export async function getAgentDashboard(req, res) {
  try {
    const branchName = String(req.query.branchName || "").trim();
    const { start, end } = getDateRangeFromQuery(req.query);
    const { cashiers, cashierIds } = await getAgentScope(req.user.sub);

    const allBranches = [
      ...new Set(
        cashiers.map((cashier) => cashier.branch_name).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    if (cashierIds.length === 0) {
      return res.json({
        generatedAt: new Date().toISOString(),
        range: { from: start, to: end },
        branches: allBranches,
        selectedBranch: branchName || "all",
        summary: {
          assignedBranches: 0,
          cashiers: 0,
          openShift: 0,
          tickets: 0,
          volume: 0,
          pendingSettlement: 0,
          liveTickets: 0,
        },
        wonToday: { tickets: 0, payable: 0 },
        wonYesterday: { tickets: 0, payable: 0 },
        activityByHour: [],
        liveTickets: [],
        cashierPerformance: [],
        branchSummary: [],
        alerts: [],
        recentActions: [],
      });
    }

    const cashierById = new Map(cashiers.map((cashier) => [cashier.id, cashier]));
    const scopedCashierIds = cashiers
      .filter((cashier) => !branchName || cashier.branch_name === branchName)
      .map((cashier) => cashier.id);

    const ticketCashierIds = branchName ? scopedCashierIds : cashierIds;

    // --- Fixed today / yesterday WON ticket buckets (filter-independent) ---
    const nowForBuckets = new Date();
    const startOfToday = new Date(
      Date.UTC(
        nowForBuckets.getUTCFullYear(),
        nowForBuckets.getUTCMonth(),
        nowForBuckets.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfToday = new Date(
      Date.UTC(
        nowForBuckets.getUTCFullYear(),
        nowForBuckets.getUTCMonth(),
        nowForBuckets.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const endOfYesterday = new Date(endOfToday.getTime() - 86400000);

    const wonWindow = async (start, end) => {
      const rows = await prisma.ticket.findMany({
        where: {
          cashier_id: { in: ticketCashierIds },
          status: "WON",
          created_at: { gte: start, lte: end },
        },
        select: { potential_win: true },
      });
      return {
        tickets: rows.length,
        payable: rows.reduce((s, t) => s + Number(t.potential_win || 0), 0),
      };
    };

    const [wonToday, wonYesterday] = await Promise.all([
      wonWindow(startOfToday, endOfToday),
      wonWindow(startOfYesterday, endOfYesterday),
    ]);

    const tickets = await prisma.ticket.findMany({
      where: {
        cashier_id: { in: ticketCashierIds },
        created_at: { gte: start, lte: end },
      },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        coupon_number: true,
        cashier_id: true,
        branch_name: true,
        stake: true,
        status: true,
        created_at: true,
      },
    });

    const actions = await prisma.auditLog.findMany({
      where: {
        user_id: req.user.sub,
        created_at: { gte: start, lte: end },
      },
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        module: true,
        created_at: true,
      },
    });

    const byHour = new Map();
    const cashierPerfMap = new Map();
    const branchSummaryMap = new Map();

    for (const ticket of tickets) {
      const hourKey = formatHourLabel(ticket.created_at);
      byHour.set(hourKey, (byHour.get(hourKey) || 0) + 1);

      const cashier = cashierById.get(ticket.cashier_id);
      const cashierName = cashier?.user?.fullname || "Cashier";
      const perf = cashierPerfMap.get(ticket.cashier_id) || {
        cashierProfileId: ticket.cashier_id,
        cashierName,
        tickets: 0,
        volume: 0,
        pending: 0,
      };
      perf.tickets += 1;
      perf.volume += Number(ticket.stake || 0);
      if (isUnsettledTicketStatus(ticket.status)) perf.pending += 1;
      cashierPerfMap.set(ticket.cashier_id, perf);

      const branch = ticket.branch_name || "Unknown";
      const branchSummary = branchSummaryMap.get(branch) || {
        branchName: branch,
        cashiers: new Set(),
        tickets: 0,
        volume: 0,
        pendingSettlement: 0,
      };
      if (ticket.cashier_id) branchSummary.cashiers.add(ticket.cashier_id);
      branchSummary.tickets += 1;
      branchSummary.volume += Number(ticket.stake || 0);
      if (isUnsettledTicketStatus(ticket.status)) {
        branchSummary.pendingSettlement += 1;
      }
      branchSummaryMap.set(branch, branchSummary);
    }

    const filteredCashiers = cashiers.filter(
      (cashier) => !branchName || cashier.branch_name === branchName,
    );

    const cashiersOnShift = filteredCashiers.filter((cashier) =>
      Boolean(cashier.user?.status),
    ).length;

    const pendingSettlement = tickets.filter((ticket) =>
      isUnsettledTicketStatus(ticket.status),
    ).length;

    const alerts = [];
    if (pendingSettlement > 0) {
      alerts.push(
        `${pendingSettlement} open tickets are pending settlement in the selected filter.`,
      );
    }
    if (tickets.length === 0) {
      alerts.push("No tickets found for the selected period.");
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      branches: allBranches,
      selectedBranch: branchName || "all",
      summary: {
        assignedBranches: new Set(filteredCashiers.map((cashier) => cashier.branch_name).filter(Boolean)).size,
        cashiers: filteredCashiers.length,
        openShift: cashiersOnShift,
        tickets: tickets.length,
        volume: tickets.reduce((sum, ticket) => sum + Number(ticket.stake || 0), 0),
        pendingSettlement,
        liveTickets: Math.min(10, tickets.length),
      },
      wonToday,
      wonYesterday,
      activityByHour: [...byHour.entries()]
        .map(([hour, ticketCount]) => ({ hour, tickets: ticketCount }))
        .sort((a, b) => a.hour.localeCompare(b.hour)),
      liveTickets: tickets.slice(0, 10).map((ticket) => ({
        id: ticket.id,
        couponNumber: ticket.coupon_number,
        branchName: ticket.branch_name || "Unknown",
        stake: Number(ticket.stake || 0),
        status: ticket.status,
        createdAt: ticket.created_at,
        cashierName: cashierById.get(ticket.cashier_id)?.user?.fullname || "Cashier",
      })),
      cashierPerformance: [...cashierPerfMap.values()].sort(
        (a, b) => b.volume - a.volume,
      ),
      branchSummary: [...branchSummaryMap.values()]
        .map((item) => ({
          branchName: item.branchName,
          cashiers: item.cashiers.size,
          tickets: item.tickets,
          volume: item.volume,
          pendingSettlement: item.pendingSettlement,
        }))
        .sort((a, b) => a.branchName.localeCompare(b.branchName)),
      alerts,
      recentActions: actions.map((item) => ({
        id: item.id,
        action: item.action,
        module: item.module,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error("getAgentDashboard error:", error);
    return res.status(500).json({ message: "Failed to load agent dashboard" });
  }
}

export async function getAgentReports(req, res) {
  try {
    const branchName = String(req.query.branchName || "").trim();
    const { start, end } = getDateRangeFromQuery(req.query);
    const { cashiers, cashierIds } = await getAgentScope(req.user.sub);

    if (cashierIds.length === 0) {
      return res.json({
        generatedAt: new Date().toISOString(),
        range: { from: start, to: end },
        branches: [],
        selectedBranch: branchName || "all",
        summary: {
          totalTickets: 0,
          totalStake: 0,
          averageStake: 0,
          openTickets: 0,
          wonTickets: 0,
          lostTickets: 0,
          paidTickets: 0,
        },
        byBranch: [],
        byCashier: [],
      });
    }

    const allBranches = [
      ...new Set(cashiers.map((cashier) => cashier.branch_name).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    const scopedCashierIds = cashiers
      .filter((cashier) => !branchName || cashier.branch_name === branchName)
      .map((cashier) => cashier.id);

    const ticketCashierIds = branchName ? scopedCashierIds : cashierIds;
    const tickets = await prisma.ticket.findMany({
      where: {
        cashier_id: { in: ticketCashierIds },
        created_at: { gte: start, lte: end },
      },
      select: {
        id: true,
        cashier_id: true,
        branch_name: true,
        stake: true,
        status: true,
      },
    });

    const cashierNameById = new Map(
      cashiers.map((cashier) => [cashier.id, cashier.user?.fullname || "Cashier"]),
    );
    const branchMap = new Map();
    const cashierMap = new Map();

    for (const ticket of tickets) {
      const branchKey = ticket.branch_name || "Unknown";
      const branchRow = branchMap.get(branchKey) || {
        branchName: branchKey,
        tickets: 0,
        stake: 0,
        open: 0,
        won: 0,
        lost: 0,
        paid: 0,
      };
      branchRow.tickets += 1;
      branchRow.stake += Number(ticket.stake || 0);
      if (isUnsettledTicketStatus(ticket.status)) branchRow.open += 1;
      if (ticket.status === "WON") branchRow.won += 1;
      if (ticket.status === "LOST") branchRow.lost += 1;
      if (ticket.status === "PAID") branchRow.paid += 1;
      branchMap.set(branchKey, branchRow);

      const cashierKey = ticket.cashier_id || "unknown";
      const cashierRow = cashierMap.get(cashierKey) || {
        cashierProfileId: cashierKey,
        cashierName: cashierNameById.get(cashierKey) || "Cashier",
        tickets: 0,
        stake: 0,
        open: 0,
        won: 0,
        lost: 0,
        paid: 0,
      };
      cashierRow.tickets += 1;
      cashierRow.stake += Number(ticket.stake || 0);
      if (isUnsettledTicketStatus(ticket.status)) cashierRow.open += 1;
      if (ticket.status === "WON") cashierRow.won += 1;
      if (ticket.status === "LOST") cashierRow.lost += 1;
      if (ticket.status === "PAID") cashierRow.paid += 1;
      cashierMap.set(cashierKey, cashierRow);
    }

    const totalStake = tickets.reduce(
      (sum, ticket) => sum + Number(ticket.stake || 0),
      0,
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      branches: allBranches,
      selectedBranch: branchName || "all",
      summary: {
        totalTickets: tickets.length,
        totalStake,
        averageStake: tickets.length > 0 ? totalStake / tickets.length : 0,
        openTickets: tickets.filter((ticket) =>
          isUnsettledTicketStatus(ticket.status),
        ).length,
        wonTickets: tickets.filter((ticket) => ticket.status === "WON").length,
        lostTickets: tickets.filter((ticket) => ticket.status === "LOST").length,
        paidTickets: tickets.filter((ticket) => ticket.status === "PAID").length,
      },
      byBranch: [...branchMap.values()].sort((a, b) =>
        a.branchName.localeCompare(b.branchName),
      ),
      byCashier: [...cashierMap.values()].sort((a, b) => b.stake - a.stake),
    });
  } catch (error) {
    console.error("getAgentReports error:", error);
    return res.status(500).json({ message: "Failed to load agent reports" });
  }
}

function playerFlowMeta(reference) {
  const ref = String(reference || "");
  if (ref.startsWith("cashier-deposit:")) {
    return {
      playerFlow: "deposit",
      playerFlowLabel: "Deposit to player",
    };
  }
  if (ref.startsWith("cashier-withdraw-approve:")) {
    return {
      playerFlow: "withdraw",
      playerFlowLabel: "Withdraw from player",
    };
  }
  return {
    playerFlow: "unknown",
    playerFlowLabel: "Other",
  };
}

/**
 * GET /api/agent/cashier-wallet-activity
 * Player-facing deposit/withdraw flows performed by assigned cashiers (tied to cashier wallet ledger lines).
 * Query: from, to, cashierProfileId?, flow?=deposit|withdraw, page?, limit?
 * — deposit: funds added to player wallet (cash shop → player)
 * — withdraw: funds taken from player wallet (player payout via cashier)
 */
export async function getAgentCashierWalletActivity(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);
    const cashierProfileId = String(req.query.cashierProfileId || "").trim();
    const flowParam = String(req.query.flow || req.query.type || "")
      .trim()
      .toLowerCase();
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const { cashiers } = await getAgentScope(req.user.sub);
    const walletIds = cashiers.map((c) => c.wallet_id).filter(Boolean);

    if (walletIds.length === 0) {
      return res.json({
        range: { from: start, to: end },
        page,
        limit,
        total: 0,
        totalPages: 1,
        items: [],
        cashiers: [],
      });
    }

    let allowedWalletIds = walletIds;
    if (cashierProfileId) {
      const match = cashiers.find((c) => c.id === cashierProfileId);
      if (!match?.wallet_id) {
        return res.status(403).json({ message: "Cashier not assigned to this agent" });
      }
      allowedWalletIds = [match.wallet_id];
    }

    const baseWhere = {
      wallet_id: { in: allowedWalletIds },
      created_at: { gte: start, lte: end },
    };

    /** Player deposit: cashier wallet debits; reference cashier-deposit: */
    const depositToPlayerClause = {
      AND: [
        { type: "WITHDRAW" },
        { reference: { startsWith: "cashier-deposit:" } },
      ],
    };
    /** Player withdrawal approved: cashier wallet credits; reference cashier-withdraw-approve: */
    const withdrawFromPlayerClause = {
      AND: [
        { type: "DEPOSIT" },
        { reference: { startsWith: "cashier-withdraw-approve:" } },
      ],
    };

    let where;
    if (flowParam === "deposit") {
      where = { ...baseWhere, ...depositToPlayerClause };
    } else if (flowParam === "withdraw") {
      where = { ...baseWhere, ...withdrawFromPlayerClause };
    } else {
      where = {
        ...baseWhere,
        OR: [depositToPlayerClause, withdrawFromPlayerClause],
      };
    }

    const walletToCashier = new Map();
    for (const c of cashiers) {
      if (c.wallet_id) {
        walletToCashier.set(c.wallet_id, {
          cashierProfileId: c.id,
          cashierName: c.user?.fullname || "Cashier",
          branchName: c.branch_name || "",
        });
      }
    }

    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          wallet_id: true,
          type: true,
          amount: true,
          balance_before: true,
          balance_after: true,
          reference: true,
          created_at: true,
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    const items = rows.map((row) => {
      const meta = walletToCashier.get(row.wallet_id) || {};
      const flow = playerFlowMeta(row.reference);
      return {
        id: row.id,
        ledgerType: row.type,
        amount: Number(row.amount || 0),
        balanceBefore: Number(row.balance_before || 0),
        balanceAfter: Number(row.balance_after || 0),
        reference: row.reference,
        createdAt: row.created_at,
        cashierProfileId: meta.cashierProfileId,
        cashierName: meta.cashierName,
        branchName: meta.branchName,
        playerFlow: flow.playerFlow,
        playerFlowLabel: flow.playerFlowLabel,
      };
    });

    const cashierOptions = cashiers.map((c) => ({
      cashierProfileId: c.id,
      cashierName: c.user?.fullname || "Cashier",
      branchName: c.branch_name || "",
    }));

    return res.json({
      range: { from: start, to: end },
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items,
      cashiers: cashierOptions,
    });
  } catch (error) {
    console.error("getAgentCashierWalletActivity error:", error);
    return res.status(500).json({ message: "Failed to load cashier wallet activity" });
  }
}
