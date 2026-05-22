/**
 * Cashier-scoped wallet controller — deposit into player wallets,
 * look up and approve player withdrawal requests, view own history.
 *
 * @module controllers/cashierWalletController
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { notifyUserSafe } from "../lib/createNotification.js";
import {
  depositNotification,
  withdrawCompletedNotification,
} from "../lib/notificationMessages.js";
import { completePendingPlayerWithdrawal } from "../lib/completePendingPlayerWithdrawal.js";
import { applyDepositBonusesInTx } from "../lib/bonusEngine.js";
import {
  digestShopWithdrawCode,
  normalizeSixDigitWithdrawCode,
  SHOP_WITHDRAW_REF_PREFIX,
} from "../lib/shopWithdraw.js";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const PLAYER_HISTORY_REFERENCE_PREFIXES = [
  "cashier-deposit:",
  "cashier-withdraw-approve:",
];

/**
 * POST /api/cashier/wallet/deposit
 * Cashier deposits into a player's account.
 * Body: { phone, amount }
 *
 * Flow: cashier balance ↓, player balance ↑
 */
export async function cashierDeposit(req, res) {
  try {
    const { phone, amount } = req.body ?? {};
    const numericAmount = Number(amount);

    if (!phone || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Valid phone and positive amount are required" });
    }

    const normalizedPhone = String(phone).trim();

    // Find player by phone
    const player = await prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { role: true, wallets: true },
    });

    if (!player || player.role?.name !== "PLAYER") {
      return res.status(404).json({ message: "Player not found with that phone number" });
    }

    const playerWallet = player.wallets.find((w) => w.wallet_type === "PLAYER");
    if (!playerWallet) {
      return res.status(404).json({ message: "Player wallet not found" });
    }

    // Find cashier's own wallet
    const cashierWallets = await prisma.wallet.findMany({
      where: { user_id: req.user.sub, wallet_type: "CASHIER" },
    });
    const cashierWallet = cashierWallets[0];
    if (!cashierWallet) {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-fetch wallets inside transaction for consistency
      const cWallet = await tx.wallet.findUnique({ where: { id: cashierWallet.id } });
      const pWallet = await tx.wallet.findUnique({ where: { id: playerWallet.id } });

      const playerUser = await tx.user.findUnique({
        where: { id: player.id },
        select: { first_deposit_at: true },
      });
      const hadFirst = playerUser?.first_deposit_at ?? null;

      const cashierBefore = Number(cWallet.balance);
      const playerBefore = Number(pWallet.balance);

      if (cashierBefore < numericAmount) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const cashierAfter = cashierBefore - numericAmount;
      const playerAfter = playerBefore + numericAmount;

      // Deduct from cashier
      await tx.wallet.update({
        where: { id: cWallet.id },
        data: { balance: cashierAfter },
      });

      // Add to player
      await tx.wallet.update({
        where: { id: pWallet.id },
        data: { balance: playerAfter },
      });

      // Record on cashier wallet (WITHDRAW — money leaving cashier)
      const cashierTx = await tx.transaction.create({
        data: {
          wallet_id: cWallet.id,
          type: "WITHDRAW",
          amount: numericAmount,
          balance_before: cashierBefore,
          balance_after: cashierAfter,
          reference: `cashier-deposit:${req.user.sub}:to:${player.id}`,
        },
      });

      // Record on player wallet (DEPOSIT — money entering player)
      const playerTx = await tx.transaction.create({
        data: {
          wallet_id: pWallet.id,
          type: "DEPOSIT",
          amount: numericAmount,
          balance_before: playerBefore,
          balance_after: playerAfter,
          reference: `cashier-deposit:${req.user.sub}:to:${player.id}`,
        },
      });

      await applyDepositBonusesInTx(tx, {
        walletId: pWallet.id,
        depositAmount: numericAmount,
        playerDepositTxId: playerTx.id,
        hadFirstDepositAt: hadFirst,
      });

      if (!hadFirst) {
        await tx.user.update({
          where: { id: player.id },
          data: { first_deposit_at: new Date() },
        });
      }

      const pFinal = await tx.wallet.findUnique({ where: { id: pWallet.id } });

      return {
        cashierBalance: cashierAfter,
        playerBalance: Number(pFinal?.balance ?? playerAfter),
        cashierTxId: cashierTx.id,
        playerTxId: playerTx.id,
      };
    });

    await logAuditEvent({
      req,
      action: "CASHIER_DEPOSIT",
      module: "WALLET",
      entityType: "WALLET",
      entityId: playerWallet.id,
      meta: {
        amount: numericAmount,
        playerPhone: normalizedPhone,
        playerId: player.id,
        cashierTxId: result.cashierTxId,
        playerTxId: result.playerTxId,
      },
    });

    const depMsg = depositNotification({ amount: numericAmount, source: "cashier" });
    void notifyUserSafe({ userId: player.id, ...depMsg });

    return res.json({
      message: "Deposit successful",
      playerName: player.name,
      playerBalance: result.playerBalance,
      cashierBalance: result.cashierBalance,
    });
  } catch (error) {
    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ message: "Insufficient cashier balance" });
    }
    console.error("cashierDeposit error:", error);
    return res.status(500).json({ message: "Failed to process deposit" });
  }
}

/**
 * GET /api/cashier/wallet/withdraw-request?phone=...
 * Fetch pending withdrawal requests for a specific player.
 */
export async function getWithdrawRequest(req, res) {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const player = await prisma.user.findUnique({
      where: { phone },
      include: { role: true, wallets: true },
    });

    if (!player || player.role?.name !== "PLAYER") {
      return res.status(404).json({ message: "Player not found with that phone number" });
    }

    const playerWallet = player.wallets.find((w) => w.wallet_type === "PLAYER");
    if (!playerWallet) {
      return res.status(404).json({ message: "Player wallet not found" });
    }

    // Find pending withdraw transactions on this player's wallet
    const pendingRequests = await prisma.transaction.findMany({
      where: {
        wallet_id: playerWallet.id,
        type: "WITHDRAW",
        reference: { startsWith: "pending:" },
        NOT: { reference: { startsWith: SHOP_WITHDRAW_REF_PREFIX } },
      },
      orderBy: { created_at: "desc" },
    });

    return res.json({
      player: {
        id: player.id,
        name: player.name,
        phone: player.phone,
      },
      walletBalance: Number(playerWallet.balance),
      requests: pendingRequests.map((tx) => ({
        id: tx.id,
        amount: Number(tx.amount),
        reference: tx.reference,
        createdAt: tx.created_at,
      })),
    });
  } catch (error) {
    console.error("getWithdrawRequest error:", error);
    return res.status(500).json({ message: "Failed to fetch withdraw requests" });
  }
}

/**
 * PATCH /api/cashier/wallet/withdraw-request/:id/approve
 * Cashier approves a player's pending withdrawal.
 *
 * Flow: player balance ↓, cashier balance ↑
 */
export async function approveWithdrawRequest(req, res) {
  try {
    const { id } = req.params;

    const preTx = await prisma.transaction.findUnique({
      where: { id },
      include: { wallet: { select: { user_id: true } } },
    });
    if (!preTx) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (preTx.reference?.startsWith(SHOP_WITHDRAW_REF_PREFIX)) {
      return res.status(400).json({
        message: "Use shop withdrawal with the one-time code at the cashier",
      });
    }

    // Find cashier wallet
    const cashierWallets = await prisma.wallet.findMany({
      where: { user_id: req.user.sub, wallet_type: "CASHIER" },
    });
    const cashierWallet = cashierWallets[0];
    if (!cashierWallet) {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }

    const result = await prisma.$transaction(async (tx) =>
      completePendingPlayerWithdrawal(tx, {
        pendingTransactionId: id,
        cashierWalletId: cashierWallet.id,
        approverUserId: req.user.sub,
      }),
    );

    await logAuditEvent({
      req,
      action: "CASHIER_WITHDRAW_APPROVED",
      module: "WALLET",
      entityType: "TRANSACTION",
      entityId: id,
      meta: {
        cashierBalance: result.cashierBalance,
        playerBalance: result.playerBalance,
      },
    });

    const playerUserId = preTx.wallet?.user_id;
    if (playerUserId) {
      const wdMsg = withdrawCompletedNotification({ amount: Number(preTx.amount) });
      void notifyUserSafe({ userId: playerUserId, ...wdMsg });
    }

    return res.json({
      message: "Withdrawal approved",
      cashierBalance: result.cashierBalance,
      playerBalance: result.playerBalance,
    });
  } catch (error) {
    if (error.message === "TX_NOT_FOUND") {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (error.message === "NOT_PENDING") {
      return res.status(400).json({ message: "Request is not pending" });
    }
    if (error.message === "NOT_WITHDRAW") {
      return res.status(400).json({ message: "Transaction is not a withdrawal" });
    }
    if (error.message === "INSUFFICIENT_PLAYER_BALANCE") {
      return res.status(400).json({ message: "Player has insufficient balance" });
    }
    if (error.message === "CASHIER_WALLET_NOT_FOUND") {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }
    console.error("approveWithdrawRequest error:", error);
    return res.status(500).json({ message: "Failed to approve withdrawal" });
  }
}

/**
 * POST /api/cashier/wallet/shop-withdraw/preview
 * Body: { phone, code } — resolve payout amount and player for confirmation (no money moved).
 */
export async function previewShopWithdraw(req, res) {
  try {
    const { phone, code } = req.body ?? {};
    const normalizedPhone = String(phone ?? "").trim();
    const normalizedCode = normalizeSixDigitWithdrawCode(code);

    if (!normalizedPhone || !normalizedCode) {
      return res.status(400).json({ message: "Valid phone and 6-digit code are required" });
    }

    const codeDigest = digestShopWithdrawCode(normalizedCode);
    const intent = await prisma.shopWithdrawIntent.findUnique({
      where: { code_digest: codeDigest },
      include: { user: { include: { role: true } } },
    });

    if (!intent) {
      return res.status(400).json({ message: "Invalid withdrawal code" });
    }

    if (intent.consumed_at) {
      return res.status(400).json({ message: "This code has already been used" });
    }

    if (intent.expires_at < new Date()) {
      return res.status(400).json({ message: "This withdrawal code has expired" });
    }

    const player = intent.user;
    if (!player || player.role?.name !== "PLAYER") {
      return res.status(400).json({ message: "Invalid withdrawal" });
    }

    if (String(player.phone ?? "").trim() !== normalizedPhone) {
      return res.status(400).json({ message: "Phone number does not match this code" });
    }

    return res.json({
      amount: Number(intent.amount),
      playerName: player.name,
      phone: normalizedPhone,
      expiresAt: intent.expires_at.toISOString(),
    });
  } catch (error) {
    console.error("previewShopWithdraw error:", error);
    return res.status(500).json({ message: "Failed to look up withdrawal" });
  }
}

/**
 * POST /api/cashier/wallet/shop-withdraw/redeem
 * Body: { phone, code } — amount is taken from the intent (optional `amount` for backward compatibility / double-check).
 */
export async function redeemShopWithdraw(req, res) {
  try {
    const { phone, amount, code } = req.body ?? {};
    const normalizedPhone = String(phone ?? "").trim();
    const normalizedCode = normalizeSixDigitWithdrawCode(code);

    if (!normalizedPhone || !normalizedCode) {
      return res.status(400).json({ message: "Valid phone and 6-digit code are required" });
    }

    const codeDigest = digestShopWithdrawCode(normalizedCode);
    const intent = await prisma.shopWithdrawIntent.findUnique({
      where: { code_digest: codeDigest },
      include: { user: { include: { role: true } } },
    });

    if (!intent) {
      return res.status(400).json({ message: "Invalid withdrawal code" });
    }

    if (intent.consumed_at) {
      return res.status(400).json({ message: "This code has already been used" });
    }

    if (intent.expires_at < new Date()) {
      return res.status(400).json({ message: "This withdrawal code has expired" });
    }

    const player = intent.user;
    if (!player || player.role?.name !== "PLAYER") {
      return res.status(400).json({ message: "Invalid withdrawal" });
    }

    if (String(player.phone ?? "").trim() !== normalizedPhone) {
      return res.status(400).json({ message: "Phone number does not match this code" });
    }

    const intentAmount = Number(intent.amount);
    let numericAmount = intentAmount;
    if (amount !== undefined && amount !== null && String(amount).trim() !== "") {
      numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }
      if (Math.abs(intentAmount - numericAmount) > 1e-6) {
        return res.status(400).json({ message: "Amount does not match this code" });
      }
    }

    const cashierWallets = await prisma.wallet.findMany({
      where: { user_id: req.user.sub, wallet_type: "CASHIER" },
    });
    const cashierWallet = cashierWallets[0];
    if (!cashierWallet) {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const pendingTxRow = await tx.transaction.findUnique({ where: { id: intent.transaction_id } });
      if (!pendingTxRow?.reference?.startsWith(SHOP_WITHDRAW_REF_PREFIX)) {
        throw new Error("CODE_ALREADY_USED");
      }

      const settlement = await completePendingPlayerWithdrawal(tx, {
        pendingTransactionId: intent.transaction_id,
        cashierWalletId: cashierWallet.id,
        approverUserId: req.user.sub,
      });

      await tx.shopWithdrawIntent.update({
        where: { id: intent.id },
        data: { consumed_at: new Date() },
      });

      return settlement;
    });

    await logAuditEvent({
      req,
      action: "CASHIER_SHOP_WITHDRAW_REDEEM",
      module: "WALLET",
      entityType: "TRANSACTION",
      entityId: intent.transaction_id,
      meta: {
        amount: numericAmount,
        playerPhone: normalizedPhone,
        playerId: intent.user_id,
        cashierBalance: result.cashierBalance,
        playerBalance: result.playerBalance,
      },
    });

    const wdMsg = withdrawCompletedNotification({ amount: numericAmount });
    void notifyUserSafe({ userId: intent.user_id, ...wdMsg });

    return res.json({
      message: "Withdrawal completed",
      playerName: player.name,
      cashierBalance: result.cashierBalance,
      playerBalance: result.playerBalance,
    });
  } catch (error) {
    if (error.message === "CODE_ALREADY_USED") {
      return res.status(400).json({ message: "This code has already been used" });
    }
    if (error.message === "NOT_PENDING") {
      return res.status(400).json({ message: "This code has already been used" });
    }
    if (error.message === "INVALID_PENDING_TX") {
      return res.status(400).json({ message: "Invalid withdrawal request" });
    }
    if (error.message === "TX_NOT_FOUND") {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (error.message === "NOT_WITHDRAW") {
      return res.status(400).json({ message: "Transaction is not a withdrawal" });
    }
    if (error.message === "INSUFFICIENT_PLAYER_BALANCE") {
      return res.status(400).json({ message: "Player has insufficient balance" });
    }
    if (error.message === "CASHIER_WALLET_NOT_FOUND") {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }
    console.error("redeemShopWithdraw error:", error);
    return res.status(500).json({ message: "Failed to complete withdrawal" });
  }
}

/**
 * GET /api/cashier/wallet/history?type=DEPOSIT|WITHDRAW&page=...
 * Cashier's own transaction history.
 */
export async function getCashierHistory(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const type = String(req.query.type || "").trim();

    // Find cashier wallet
    const cashierWallets = await prisma.wallet.findMany({
      where: { user_id: req.user.sub, wallet_type: "CASHIER" },
    });
    const cashierWallet = cashierWallets[0];
    if (!cashierWallet) {
      return res.status(404).json({ message: "Cashier wallet not found" });
    }

    const where = {
      wallet_id: cashierWallet.id,
      OR: PLAYER_HISTORY_REFERENCE_PREFIXES.map((prefix) => ({
        reference: { startsWith: prefix },
      })),
    };
    if (type) where.type = type;

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
      balance: Number(cashierWallet.balance),
      items: items.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        balanceBefore: Number(tx.balance_before),
        balanceAfter: Number(tx.balance_after),
        reference: tx.reference,
        createdAt: tx.created_at,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("getCashierHistory error:", error);
    return res.status(500).json({ message: "Failed to load history" });
  }
}
