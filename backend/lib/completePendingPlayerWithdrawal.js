/**
 * Shared settlement: pending player WITHDRAW → debit player, credit cashier, update pending row, ledger cashier DEPOSIT.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
import { debitWallet } from "./walletBalance.js";

export async function completePendingPlayerWithdrawal(tx, {
  pendingTransactionId,
  cashierWalletId,
  approverUserId,
}) {
  const transaction = await tx.transaction.findUnique({ where: { id: pendingTransactionId } });
  if (!transaction) throw new Error("TX_NOT_FOUND");
  if (!transaction.reference?.startsWith("pending:")) throw new Error("NOT_PENDING");
  if (transaction.type !== "WITHDRAW") throw new Error("NOT_WITHDRAW");

  const amount = Number(transaction.amount);

  const pWallet = await tx.wallet.findUnique({ where: { id: transaction.wallet_id } });
  if (!pWallet) throw new Error("WALLET_NOT_FOUND");

  let playerDebit;
  try {
    playerDebit = await debitWallet(tx, pWallet, amount, {
      fromWithdrawable: true,
    });
  } catch (err) {
    if (err?.message === "INSUFFICIENT_BALANCE") {
      throw new Error("INSUFFICIENT_PLAYER_BALANCE");
    }
    if (err?.message === "INSUFFICIENT_WITHDRAWABLE") {
      throw new Error("INSUFFICIENT_WITHDRAWABLE");
    }
    throw err;
  }

  const cWallet = await tx.wallet.findUnique({ where: { id: cashierWalletId } });
  if (!cWallet) throw new Error("CASHIER_WALLET_NOT_FOUND");

  const cashierBefore = Number(cWallet.balance);
  const cashierAfter = cashierBefore + amount;

  await tx.wallet.update({
    where: { id: cWallet.id },
    data: { balance: cashierAfter },
  });

  const updatedTx = await tx.transaction.update({
    where: { id: pendingTransactionId },
    data: {
      reference: transaction.reference.replace("pending:", `approved:${approverUserId}:`),
      balance_before: playerDebit.balanceBefore,
      balance_after: playerDebit.balanceAfter,
    },
  });

  await tx.transaction.create({
    data: {
      wallet_id: cWallet.id,
      type: "DEPOSIT",
      amount,
      balance_before: cashierBefore,
      balance_after: cashierAfter,
      reference: `cashier-withdraw-approve:${approverUserId}:from:${pWallet.user_id}`,
    },
  });

  return {
    transaction: updatedTx,
    cashierBalance: cashierAfter,
    playerBalance: playerDebit.balanceAfter,
  };
}
