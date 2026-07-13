import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { buildCashoutQuote, loadTicketForCashout } from "../services/cashoutService.js";
import { creditWallet } from "../lib/walletBalance.js";

async function resolveCashierByUserId(userId) {
  if (!userId) return null;
  return prisma.cashier.findUnique({
    where: { user_id: userId },
  });
}

function mapCashoutSummary(cashout) {
  if (!cashout) return null;
  return {
    id: cashout.id,
    amount: cashout.amount,
    processedBy: cashout.processed_by,
    createdAt: cashout.created_at,
  };
}

async function resolveCashoutContext(req, { forPlayerRoute = false } = {}) {
  const ticket = await loadTicketForCashout(prisma, req.params.id);
  if (!ticket) {
    return {
      error: {
        status: 404,
        body: { message: "Ticket not found" },
      },
    };
  }

  if (forPlayerRoute || req.user?.role === "PLAYER") {
    if (ticket.user_id !== req.user?.sub) {
      return {
        error: {
          status: 403,
          body: { message: "Access denied" },
        },
      };
    }
    if (ticket.cashier_id) {
      return {
        error: {
          status: 403,
          body: { message: "Ticket has been claimed by a cashier" },
        },
      };
    }
    return { ticket, processorUserId: req.user.sub };
  }

  if (req.user?.role === "CASHIER") {
    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return {
        error: {
          status: 404,
          body: { message: "Cashier profile not found" },
        },
      };
    }
    if (ticket.cashier_id !== cashier.id) {
      return {
        error: {
          status: 403,
          body: { message: "Cashout rejected: ticket belongs to another cashier" },
        },
      };
    }
    return { ticket, processorUserId: req.user.sub };
  }

  return { ticket, processorUserId: req.user?.sub || null };
}

export async function quoteTicketCashout(req, res) {
  try {
    const context = await resolveCashoutContext(req);
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }
    const quote = await buildCashoutQuote(prisma, context.ticket);
    return res.json({
      ticketId: context.ticket.id,
      status: context.ticket.status,
      quote,
      cashout: mapCashoutSummary(context.ticket.cashout),
    });
  } catch (error) {
    console.error("quoteTicketCashout error:", error);
    return res.status(500).json({ message: "Failed to compute cashout quote" });
  }
}

export async function executeTicketCashout(req, res) {
  try {
    const context = await resolveCashoutContext(req);
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }

    const existingQuote = await buildCashoutQuote(prisma, context.ticket);
    if (!existingQuote.allowed) {
      return res.status(400).json({
        message: "Ticket is not eligible for cashout",
        quote: existingQuote,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const freshTicket = await loadTicketForCashout(tx, context.ticket.id);
      if (!freshTicket) throw new Error("Ticket not found");

      if (freshTicket.cashout) {
        return {
          alreadyProcessed: true,
          ticket: freshTicket,
          quote: await buildCashoutQuote(tx, freshTicket),
        };
      }

      const quote = await buildCashoutQuote(tx, freshTicket);
      if (!quote.allowed) {
        const err = new Error("Ticket is not eligible for cashout");
        err.statusCode = 400;
        err.quote = quote;
        throw err;
      }

      let targetWallet = null;
      if (freshTicket.cashier_id) {
        targetWallet = freshTicket.cashier?.wallet || null;
      } else {
        targetWallet =
          freshTicket.user?.wallets?.find((wallet) => wallet.wallet_type === "PLAYER") ||
          null;
      }

      if (!targetWallet) {
        throw new Error("Target wallet not found");
      }

      const amount = Number(quote.amount || 0);
      // Player cashouts are withdrawable winnings; cashier float is plain balance.
      const credited = await creditWallet(tx, targetWallet, amount, {
        withdrawable: targetWallet.wallet_type === "PLAYER",
      });

      await tx.transaction.create({
        data: {
          wallet_id: targetWallet.id,
          type: "CASHOUT",
          amount,
          balance_before: credited.balanceBefore,
          balance_after: credited.balanceAfter,
          reference: `cashout:${freshTicket.id}`,
        },
      });

      const { count } = await tx.ticket.updateMany({
        where: { id: freshTicket.id, status: { in: ["OPEN", "PRINTED"] } },
        data: { status: "CASHED_OUT" },
      });
      if (count === 0) {
        throw Object.assign(new Error("STATUS_CONFLICT"), { statusCode: 409 });
      }
      const updatedTicket = { ...freshTicket, status: "CASHED_OUT" };

      const cashout = await tx.cashOut.create({
        data: {
          ticket_id: freshTicket.id,
          amount,
          processed_by: context.processorUserId,
        },
      });

      return {
        alreadyProcessed: false,
        ticket: updatedTicket,
        cashout,
        quote,
        walletBalance: credited.balanceAfter,
      };
    });

    if (!result.alreadyProcessed) {
      await logAuditEvent({
        req,
        action: "CASH_OUT_EXECUTED",
        module: "TICKETS",
        entityType: "TICKET",
        entityId: context.ticket.id,
        before: { status: context.ticket.status },
        after: {
          status: "CASHED_OUT",
          amount: result.quote.amount,
          margin: result.quote.breakdown.margin,
          walletBalance: result.walletBalance,
          profile: result.quote.profile,
        },
      });
    }

    return res.json({
      message: result.alreadyProcessed ? "Ticket already cashed out" : "Ticket cashed out",
      ticket: result.ticket,
      quote: result.quote,
      cashout: mapCashoutSummary(result.cashout || result.ticket.cashout),
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "Ticket already cashed out",
        code: "already_cashed_out",
        alreadyProcessed: true,
      });
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({
        message: "Ticket status changed concurrently",
        code: "status_conflict",
      });
    }
    console.error("executeTicketCashout error:", error);
    if (error.statusCode === 400) {
      return res.status(400).json({
        message: error.message,
        quote: error.quote || null,
      });
    }
    return res.status(500).json({ message: "Failed to execute cashout" });
  }
}

export async function quoteOwnTicketCashout(req, res) {
  const context = await resolveCashoutContext(req, { forPlayerRoute: true });
  if (context.error) {
    return res.status(context.error.status).json(context.error.body);
  }
  const quote = await buildCashoutQuote(prisma, context.ticket);
  return res.json({
    ticketId: context.ticket.id,
    status: context.ticket.status,
    quote,
    cashout: mapCashoutSummary(context.ticket.cashout),
  });
}

export async function executeOwnTicketCashout(req, res) {
  return executeTicketCashout(req, res);
}
