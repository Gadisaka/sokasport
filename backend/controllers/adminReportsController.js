import { prisma } from "../Config/db.js";
import { buildSalesReportAggregates } from "../lib/ticketPayday.js";

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

/** OPEN = not printed yet; PRINTED = sold, still awaiting match settlement */
function isUnsettledTicketStatus(status) {
  return status === "OPEN" || status === "PRINTED";
}

/**
 * GET /api/admin/reports/sales
 * Ticket sales (stakes) for admins: optional agent + cashier filters.
 * Query: from, to (YYYY-MM-DD), agentId?, cashierProfileId?, max ~93 days.
 */
export async function getAdminSalesReports(req, res) {
  try {
    const { start, end } = getDateRangeFromQuery(req.query);
    const daySpan = diffUtcDaysInclusive(start, end);
    if (daySpan > MAX_REPORT_RANGE_DAYS) {
      return res.status(400).json({
        message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
      });
    }

    const agentId = String(req.query.agentId || "").trim();
    const cashierProfileId = String(req.query.cashierProfileId || "").trim();

    if (agentId) {
      const agent = await prisma.user.findUnique({
        where: { id: agentId },
        include: { role: true },
      });
      if (!agent || agent.role?.name !== "AGENT") {
        return res.status(400).json({ message: "Invalid agentId" });
      }
    }

    if (cashierProfileId) {
      const cashier = await prisma.cashier.findUnique({
        where: { id: cashierProfileId },
      });
      if (!cashier) {
        return res.status(400).json({ message: "Invalid cashierProfileId" });
      }
    }

    if (agentId && cashierProfileId) {
      const link = await prisma.agentCashier.findFirst({
        where: { agent_id: agentId, cashier_id: cashierProfileId },
      });
      if (!link) {
        return res.status(400).json({
          message: "Selected cashier is not assigned to the selected agent",
        });
      }
    }

    const where = {
      created_at: { gte: start, lte: end },
    };

    if (cashierProfileId) {
      where.cashier_id = cashierProfileId;
    } else if (agentId) {
      const assignments = await prisma.agentCashier.findMany({
        where: { agent_id: agentId },
        select: { cashier_id: true },
      });
      const ids = assignments.map((a) => a.cashier_id).filter(Boolean);
      if (ids.length === 0) {
        return res.json(emptySalesPayload(start, end, { agentId, cashierProfileId }));
      }
      where.cashier_id = { in: ids };
    }

    const paidWhere = {
      paid_at: { gte: start, lte: end },
      status: { in: ["PAID", "CASHBACK_PAID"] },
    };
    if (where.cashier_id) paidWhere.cashier_id = where.cashier_id;

    const [tickets, paidTickets] = await Promise.all([
      prisma.ticket.findMany({
        where,
        select: {
          id: true,
          cashier_id: true,
          branch_name: true,
          stake: true,
          status: true,
          created_at: true,
        },
      }),
      prisma.ticket.findMany({
        where: paidWhere,
        select: {
          id: true,
          cashier_id: true,
          branch_name: true,
          status: true,
          paid_at: true,
        },
      }),
    ]);

    const cashierIds = [
      ...new Set(
        [...tickets, ...paidTickets].map((t) => t.cashier_id).filter(Boolean),
      ),
    ];
    const cashierRows =
      cashierIds.length > 0
        ? await prisma.cashier.findMany({
            where: { id: { in: cashierIds } },
            include: { user: { select: { fullname: true } } },
          })
        : [];
    const cashierNameById = new Map(
      cashierRows.map((c) => [c.id, c.user?.fullname || "Cashier"]),
    );

    const {
      dailyMap,
      branchMap,
      cashierMap,
      totalStake,
      paidTicketsCount,
      cashbackPaidTicketsCount,
    } = buildSalesReportAggregates({
      soldTickets: tickets,
      paidTickets,
      start,
      daySpan,
      getDayLabel,
      cashierNameById,
    });

    const byDay = [...dailyMap.values()];
    const byBranch = [...branchMap.values()].sort((a, b) =>
      a.branchName.localeCompare(b.branchName),
    );
    const byCashier = [...cashierMap.values()].sort((a, b) => b.stake - a.stake);

    return res.json({
      generatedAt: new Date().toISOString(),
      range: { from: start, to: end },
      filters: {
        agentId: agentId || null,
        cashierProfileId: cashierProfileId || null,
      },
      summary: {
        totalTickets: tickets.length,
        totalStake,
        averageStake: tickets.length > 0 ? totalStake / tickets.length : 0,
        openTickets: tickets.filter((t) => isUnsettledTicketStatus(t.status)).length,
        wonTickets: tickets.filter((t) => t.status === "WON").length,
        lostTickets: tickets.filter((t) => t.status === "LOST").length,
        paidTickets: paidTicketsCount,
        cashbackPaidTickets: cashbackPaidTicketsCount,
      },
      byDay,
      byBranch,
      byCashier,
    });
  } catch (error) {
    console.error("getAdminSalesReports error:", error);
    return res.status(500).json({ message: "Failed to load sales report" });
  }
}

function emptySalesPayload(start, end, filters) {
  const daySpan = diffUtcDaysInclusive(start, end);
  const byDay = [];
  for (let i = 0; i < daySpan; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    byDay.push({
      date: ymd,
      dayLabel: getDayLabel(d),
      tickets: 0,
      stake: 0,
      open: 0,
      won: 0,
      lost: 0,
      paid: 0,
      cashbackPaid: 0,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    range: { from: start, to: end },
    filters: {
      agentId: filters.agentId || null,
      cashierProfileId: filters.cashierProfileId || null,
    },
    summary: {
      totalTickets: 0,
      totalStake: 0,
      averageStake: 0,
      openTickets: 0,
      wonTickets: 0,
      lostTickets: 0,
      paidTickets: 0,
      cashbackPaidTickets: 0,
    },
    byDay,
    byBranch: [],
    byCashier: [],
  };
}
