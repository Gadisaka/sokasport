/**
 * Cashier claim-time cashback quote + payout for printed LOST tickets.
 *
 * @module controllers/cashbackPayoutController
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { cashbackPayoutRef } from "../lib/bonusEngine.js";
import {
  buildCashbackQuote,
  hasCashierPrintTx,
} from "../services/cashbackPayoutService.js";

const CASHIER_PROFILE_MISSING_MESSAGE =
  "Cashier profile not found. Ask admin to create/assign this cashier in Agents & Cashiers.";

async function resolveCashierByUserId(userId) {
  if (!userId) return null;
  return prisma.cashier.findUnique({
    where: { user_id: userId },
  });
}

/**
 * Resolve selling-cashier identity the same way payoutTicket does.
 * @returns {Promise<{ cashierId?: string, error?: { status: number, body: object } }>}
 */
async function resolveEffectiveCashierId(req) {
  const { cashierId } = req.body ?? {};
  if (req.user?.role === "CASHIER") {
    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return {
        error: {
          status: 404,
          body: { message: CASHIER_PROFILE_MISSING_MESSAGE },
        },
      };
    }
    return { cashierId: cashier.id };
  }
  if (!cashierId) {
    return {
      error: {
        status: 400,
        body: { message: "cashierId is required" },
      },
    };
  }
  return { cashierId };
}

/**
 * GET /api/tickets/:id/cashback-quote
 */
export async function quoteTicketCashback(req, res) {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Cashier role may only quote tickets they sold.
    if (req.user?.role === "CASHIER") {
      const cashier = await resolveCashierByUserId(req.user.sub);
      if (!cashier) {
        return res
          .status(404)
          .json({ message: CASHIER_PROFILE_MISSING_MESSAGE });
      }
      if (ticket.cashier_id !== cashier.id) {
        return res.status(403).json({
          message:
            "Cashback quote rejected: ticket belongs to another cashier",
        });
      }
    }

    const quote = await buildCashbackQuote(prisma, ticket);
    return res.json({
      ticketId: ticket.id,
      status: ticket.status,
      quote,
    });
  } catch (error) {
    console.error("quoteTicketCashback error:", error);
    return res
      .status(500)
      .json({ message: "Failed to compute cashback quote" });
  }
}

/**
 * PATCH /api/tickets/:id/cashback-payout
 * Body: { cashierId } — must equal ticket.cashier_id (pay only at selling cashier).
 * Credits cashier wallet, records BONUS transaction, sets ticket CASHBACK_PAID.
 */
export async function payoutTicketCashback(req, res) {
  try {
    const resolved = await resolveEffectiveCashierId(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const effectiveCashierId = resolved.cashierId;

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "LOST") {
      return res.status(400).json({
        message: "Only LOST tickets can receive cashback payout",
        code: "ticket_not_lost",
      });
    }

    if (ticket.cashier_id !== effectiveCashierId) {
      return res.status(403).json({
        message:
          "Cashback payout rejected: ticket must be paid by the selling cashier",
      });
    }

    if (!ticket.receipt_number) {
      return res.status(400).json({
        message:
          "Ticket has no receipt number; complete pay-in or print before cashback payout",
      });
    }

    const printed = await hasCashierPrintTx(prisma, ticket.id);
    if (!printed) {
      return res.status(400).json({
        message: "Cashback payout is only available for cashier-printed tickets",
        code: "not_cashier_ticket",
      });
    }

    const cashier = await prisma.cashier.findUnique({
      where: { id: effectiveCashierId },
    });
    if (!cashier) {
      return res.status(400).json({ message: "Invalid cashierId" });
    }

    const preQuote = await buildCashbackQuote(prisma, ticket);
    if (!preQuote.allowed) {
      return res.status(400).json({
        message: "Ticket is not eligible for cashback",
        quote: preQuote,
      });
    }

    const payoutRef = cashbackPayoutRef(ticket.id);
    const alreadyPaid = await prisma.transaction.findFirst({
      where: { reference: payoutRef },
      select: { id: true },
    });
    if (alreadyPaid) {
      return res.status(409).json({
        message: "Cashback has already been paid for this ticket",
        code: "already_paid",
      });
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const fresh = await tx.ticket.findUnique({
          where: { id: ticket.id },
        });
        if (!fresh || fresh.status !== "LOST") {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }

        const quote = await buildCashbackQuote(tx, fresh);
        if (!quote.allowed) {
          const err = new Error("Ticket is not eligible for cashback");
          err.statusCode = 400;
          err.quote = quote;
          throw err;
        }

        const amount = Number(quote.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          const err = new Error("Computed cashback amount is not positive");
          err.statusCode = 400;
          err.quote = quote;
          throw err;
        }

        const wallet = await tx.wallet.findUnique({
          where: { id: cashier.wallet_id },
        });
        if (!wallet) {
          throw new Error("Cashier wallet not found");
        }

        const balanceBefore = Number(wallet.balance);
        const balanceAfter = balanceBefore + amount;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });

        await tx.transaction.create({
          data: {
            wallet_id: wallet.id,
            type: "BONUS",
            amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference: payoutRef,
          },
        });

        const { count } = await tx.ticket.updateMany({
          where: { id: ticket.id, status: "LOST" },
          data: { status: "CASHBACK_PAID" },
        });
        if (count === 0) {
          throw Object.assign(new Error("STATUS_CONFLICT"), {
            statusCode: 409,
          });
        }

        return {
          paidTicket: { ...fresh, status: "CASHBACK_PAID" },
          walletBalance: balanceAfter,
          quote,
          amount,
        };
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "Cashback has already been paid for this ticket",
          code: "already_paid",
        });
      }
      if (err?.statusCode === 409) {
        return res.status(409).json({
          message:
            "Ticket status changed concurrently; cashback payout rejected",
          code: "status_conflict",
        });
      }
      if (err?.statusCode === 400) {
        return res.status(400).json({
          message: err.message,
          quote: err.quote || null,
        });
      }
      throw err;
    }

    await logAuditEvent({
      req,
      action: "TICKET_CASHBACK_PAID",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: {
        status: result.paidTicket.status,
        amount: result.amount,
        cashierWalletBalance: result.walletBalance,
      },
      meta: { cashierId: effectiveCashierId },
    });

    return res.json({
      message: "Cashback paid successfully",
      ticket: result.paidTicket,
      quote: result.quote,
      amount: result.amount,
      cashierWalletBalance: result.walletBalance,
    });
  } catch (error) {
    console.error("payoutTicketCashback error:", error);
    return res
      .status(500)
      .json({ message: "Failed to payout ticket cashback" });
  }
}
