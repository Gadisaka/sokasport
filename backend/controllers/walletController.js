/**
 * Admin wallet controller — fill/deduct cashier floats, view transaction history,
 * and Financial Support deposit/withdrawal approval workflow.
 *
 * Deposit/withdrawal requests are modeled as Transaction rows with a `status` field
 * approach: we use the existing Transaction model with reference prefixes to track
 * pending requests (PENDING_DEPOSIT / PENDING_WITHDRAW), then approve/reject/hold.
 *
 * For now, pending requests are transactions with a reference prefix convention:
 *   - "pending:deposit:<walletId>"  → awaiting approval
 *   - "pending:withdraw:<walletId>" → awaiting approval
 * Approved transactions remove the prefix; rejected ones are soft-marked via reference.
 *
 * @module controllers/walletController
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { creditWallet, debitWallet } from "../lib/walletBalance.js";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseRequestReference(reference = "") {
  const raw = String(reference || "");
  if (raw.startsWith("pending:")) return "PENDING";
  if (raw.startsWith("approved:")) return "APPROVED";
  if (raw.startsWith("rejected:")) return "REJECTED";
  if (raw.startsWith("held:")) return "HELD";
  return "COMPLETED";
}

/**
 * GET /api/admin/wallet/wallets
 * Searchable wallet directory for CASHIER / PLAYER wallets.
 */
export async function listWallets(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const walletType = String(req.query.walletType || "").trim();

    const where = {};
    if (walletType) where.wallet_type = walletType;
    if (search) {
      where.user = {
        OR: [
          { fullname: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      prisma.wallet.findMany({
        where,
        orderBy: { id: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            include: {
              role: true,
              cashier_profile: true,
            },
          },
        },
      }),
      prisma.wallet.count({ where }),
    ]);

    return res.json({
      items: items.map((wallet) => ({
        id: wallet.id,
        walletType: wallet.wallet_type,
        balance: Number(wallet.balance),
        user: {
          id: wallet.user.id,
          fullname: wallet.user.fullname,
          phone: wallet.user.phone,
          email: wallet.user.email,
          role: wallet.user.role?.name ?? null,
          branch: wallet.user.cashier_profile
            ? {
                name: wallet.user.cashier_profile.branch_name,
                location: wallet.user.cashier_profile.branch_location,
              }
            : null,
        },
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listWallets error:", error);
    return res.status(500).json({ message: "Failed to list wallets" });
  }
}

/**
 * POST /api/admin/wallet/:walletId/fill
 * Increase balance (admin fills cashier float).
 * Body: { amount, reference? }
 */
export async function fillWallet(req, res) {
  try {
    const { walletId } = req.params;
    const { amount, reference } = req.body ?? {};

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + numericAmount;

      await tx.wallet.update({
        where: { id: walletId },
        data: { balance: balanceAfter },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id: walletId,
          type: "DEPOSIT",
          amount: numericAmount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          reference: reference || `admin:fill:${walletId}:${randomUUID()}`,
        },
      });

      return { balance: balanceAfter, transaction };
    });
    await logAuditEvent({
      req,
      action: "WALLET_FILLED",
      module: "WALLET",
      entityType: "WALLET",
      entityId: walletId,
      before: { balance: result.transaction.balance_before },
      after: { balance: result.transaction.balance_after },
      meta: { amount: numericAmount, transactionId: result.transaction.id },
    });

    return res.json({
      message: "Wallet filled successfully",
      balance: result.balance,
      transactionId: result.transaction.id,
    });
    
  } catch (error) {
    if (error.message === "WALLET_NOT_FOUND") {
      return res.status(404).json({ message: "Wallet not found" });
    }
    console.error("fillWallet error:", error);
    return res.status(500).json({ message: "Failed to fill wallet" });
  }
}

/**
 * POST /api/admin/wallet/:walletId/deduct
 * Decrease balance (admin settlement — cashier returns money).
 * Body: { amount, reference? }
 */
export async function deductWallet(req, res) {
  try {
    const { walletId } = req.params;
    const { amount, reference } = req.body ?? {};

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < numericAmount) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const balanceAfter = balanceBefore - numericAmount;

      await tx.wallet.update({
        where: { id: walletId },
        data: { balance: balanceAfter },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id: walletId,
          type: "WITHDRAW",
          amount: numericAmount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          reference: reference || `admin:deduct:${walletId}:${randomUUID()}`,
        },
      });

      return { balance: balanceAfter, transaction };
    });
    await logAuditEvent({
      req,
      action: "WALLET_DEDUCTED",
      module: "WALLET",
      entityType: "WALLET",
      entityId: walletId,
      before: { balance: result.transaction.balance_before },
      after: { balance: result.transaction.balance_after },
      meta: { amount: numericAmount, transactionId: result.transaction.id },
    });

    return res.json({
      message: "Wallet deducted successfully",
      balance: result.balance,
      transactionId: result.transaction.id,
    });
  } catch (error) {
    if (error.message === "WALLET_NOT_FOUND") {
      return res.status(404).json({ message: "Wallet not found" });
    }
    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }
    console.error("deductWallet error:", error);
    return res.status(500).json({ message: "Failed to deduct wallet" });
  }
}

/**
 * GET /api/admin/wallet/:walletId/history
 * Paginated transaction history for any wallet.
 */
export async function getWalletHistory(req, res) {
  try {
    const { walletId } = req.params;

    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const where = { wallet_id: walletId };

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.json({
      items: items.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        balanceBefore: tx.balance_before,
        balanceAfter: tx.balance_after,
        reference: tx.reference,
        createdAt: tx.created_at,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("getWalletHistory error:", error);
    return res.status(500).json({ message: "Failed to get wallet history" });
  }
}

/**
 * GET /api/admin/wallet/pending
 * Lists all pending deposit/withdrawal requests (transactions with "pending:" reference prefix).
 */
export async function listPendingRequests(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const status = String(req.query.status || "PENDING").toUpperCase();
    const type = String(req.query.type || "").toUpperCase();
    const statusPrefix =
      status === "APPROVED"
        ? "approved:"
        : status === "REJECTED"
          ? "rejected:"
          : status === "HELD"
            ? "held:"
            : "pending:";
    const where = { reference: { startsWith: statusPrefix } };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          wallet: {
            include: { user: { select: { id: true, fullname: true, phone: true } } },
          },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.json({
      items: items.map((tx) => ({
        id: tx.id,
        type: tx.type,
        status: parseRequestReference(tx.reference),
        amount: tx.amount,
        reference: tx.reference,
        createdAt: tx.created_at,
        wallet: {
          id: tx.wallet.id,
          walletType: tx.wallet.wallet_type,
          balance: tx.wallet.balance,
        },
        user: tx.wallet.user,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listPendingRequests error:", error);
    return res.status(500).json({ message: "Failed to list pending requests" });
  }
}

/**
 * GET /api/admin/wallet/history
 * Paginated global transaction history across wallets.
 */
export async function getGlobalWalletHistory(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const type = String(req.query.type || "").trim();
    const walletType = String(req.query.walletType || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const where = {};
    if (type) where.type = type;
    if (walletType) where.wallet = { wallet_type: walletType };
    if (search) {
      where.OR = [
        { reference: { contains: search, mode: "insensitive" } },
        { wallet: { user: { name: { contains: search, mode: "insensitive" } } } },
        { wallet: { user: { phone: { contains: search, mode: "insensitive" } } } },
      ];
    }
    if (from || to) {
      where.created_at = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) where.created_at.gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
          if (!to.includes("T")) toDate.setHours(23, 59, 59, 999);
          where.created_at.lte = toDate;
        }
      }
      if (Object.keys(where.created_at).length === 0) delete where.created_at;
    }

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          wallet: {
            include: {
              user: { select: { id: true, fullname: true, phone: true, email: true } },
            },
          },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.json({
      items: items.map((tx) => ({
        id: tx.id,
        type: tx.type,
        status: parseRequestReference(tx.reference),
        amount: Number(tx.amount),
        balanceBefore: Number(tx.balance_before),
        balanceAfter: Number(tx.balance_after),
        reference: tx.reference,
        createdAt: tx.created_at,
        wallet: {
          id: tx.wallet.id,
          walletType: tx.wallet.wallet_type,
          balance: Number(tx.wallet.balance),
        },
        user: tx.wallet.user,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("getGlobalWalletHistory error:", error);
    return res.status(500).json({ message: "Failed to load wallet transaction history" });
  }
}

/**
 * PATCH /api/admin/wallet/requests/:id/approve
 * Approves a pending deposit/withdraw — applies balance change and clears the pending prefix.
 */
export async function approveRequest(req, res) {
  try {
    const { id } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({ where: { id } });
      if (!transaction) throw new Error("TX_NOT_FOUND");
      if (!transaction.reference?.startsWith("pending:")) {
        throw new Error("NOT_PENDING");
      }

      const wallet = await tx.wallet.findUnique({
        where: { id: transaction.wallet_id },
      });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      const amount = Number(transaction.amount);
      let applied;

      if (transaction.type === "DEPOSIT") {
        // Admin-approved deposits to player wallets are not withdrawable.
        applied = await creditWallet(tx, wallet, amount, {
          withdrawable: false,
        });
      } else {
        // Player withdrawals must come from withdrawable; cashier floats use plain balance.
        try {
          applied = await debitWallet(tx, wallet, amount, {
            fromWithdrawable: wallet.wallet_type === "PLAYER",
          });
        } catch (err) {
          if (
            err?.message === "INSUFFICIENT_BALANCE" ||
            err?.message === "INSUFFICIENT_WITHDRAWABLE"
          ) {
            throw new Error("INSUFFICIENT_BALANCE");
          }
          throw err;
        }
      }

      const updatedTx = await tx.transaction.update({
        where: { id },
        data: {
          reference: transaction.reference.replace("pending:", `approved:${req.user.sub}:`),
          balance_before: applied.balanceBefore,
          balance_after: applied.balanceAfter,
        },
      });

      return updatedTx;
    });
    await logAuditEvent({
      req,
      action: "WALLET_REQUEST_APPROVED",
      module: "WALLET",
      entityType: "TRANSACTION",
      entityId: id,
      before: null,
      after: result,
    });

    return res.json({ message: "Request approved", transaction: result });
  } catch (error) {
    if (error.message === "TX_NOT_FOUND") {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (error.message === "NOT_PENDING") {
      return res.status(400).json({ message: "Transaction is not pending" });
    }
    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ message: "Insufficient wallet balance for withdrawal" });
    }
    console.error("approveRequest error:", error);
    return res.status(500).json({ message: "Failed to approve request" });
  }
}

/**
 * PATCH /api/admin/wallet/requests/:id/reject
 * Rejects a pending request — marks reference as rejected, no balance change.
 */
export async function rejectRequest(req, res) {
  try {
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (!transaction.reference?.startsWith("pending:")) {
      return res.status(400).json({ message: "Transaction is not pending" });
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        reference: transaction.reference.replace("pending:", `rejected:${req.user.sub}:`),
      },
    });
    await logAuditEvent({
      req,
      action: "WALLET_REQUEST_REJECTED",
      module: "WALLET",
      entityType: "TRANSACTION",
      entityId: id,
      before: transaction,
      after: updated,
    });

    return res.json({ message: "Request rejected", transaction: updated });
  } catch (error) {
    console.error("rejectRequest error:", error);
    return res.status(500).json({ message: "Failed to reject request" });
  }
}

/**
 * PATCH /api/admin/wallet/requests/:id/hold
 * Puts a pending request on hold — marks reference as held, no balance change.
 */
export async function holdRequest(req, res) {
  try {
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (!transaction.reference?.startsWith("pending:")) {
      return res.status(400).json({ message: "Transaction is not pending" });
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        reference: transaction.reference.replace("pending:", `held:${req.user.sub}:`),
      },
    });
    await logAuditEvent({
      req,
      action: "WALLET_REQUEST_HELD",
      module: "WALLET",
      entityType: "TRANSACTION",
      entityId: id,
      before: transaction,
      after: updated,
    });

    return res.json({ message: "Request put on hold", transaction: updated });
  } catch (error) {
    console.error("holdRequest error:", error);
    return res.status(500).json({ message: "Failed to hold request" });
  }
}
