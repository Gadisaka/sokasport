/**
 * POST /api/player/wallet/online-deposit — verify external transfer + credit player wallet once per payment ref.
 */
import { prisma } from "../Config/db.js";
import { notifyUserSafe } from "../lib/createNotification.js";
import { depositNotification } from "../lib/notificationMessages.js";
import { extractOnlineDepositFromSms } from "../lib/depositSmsExtract.js";
import {
  resolveBettingLimits,
  getDepositAmountViolation,
} from "../lib/bettingLimits.js";
import {
  amountsMatch,
  buildOnlinePayLedgerReference,
  isOnlinePayMethod,
  isSuccessfulVerification,
  normalizeEthiopiaPhone,
  parseVerifiedAmountEtb,
  sanitizePaySegment,
} from "../lib/onlineDepositVerify.js";
import {
  ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
  parseReceiversSetting,
  verifyResponseMatchesReceivers,
} from "../lib/onlineDepositReceiversConfig.js";
import {
  isPaymentVerifyConfigured,
  verifyPaymentRemote,
} from "../services/paymentVerifyClient.js";
import { applyDepositBonusesInTx } from "../lib/bonusEngine.js";
import { creditWallet } from "../lib/walletBalance.js";

function verifySummaryFromResponse(method, data) {
  const m = String(method).toLowerCase();
  if (m === "telebirr") {
    const d = data?.data && typeof data.data === "object" ? data.data : {};
    return {
      payerName: d.payerName ?? null,
      paymentDate: d.paymentDate ?? null,
      receiptNo: d.receiptNo ?? null,
    };
  }
  if (m === "cbe") {
    return {
      payer: data?.payer ?? null,
      date: data?.date ?? null,
      reference: data?.reference ?? null,
    };
  }
  if (m === "cbebirr") {
    return {
      customerName: data?.customerName ?? null,
      transactionDate: data?.transactionDate ?? null,
      reference: data?.reference ?? data?.orderId ?? null,
    };
  }
  return {};
}

function remotePayloadForMethod(method, parts) {
  const m = String(method).toLowerCase();
  if (m === "cbe") {
    return {
      reference: sanitizePaySegment(parts.reference),
      accountSuffix: sanitizePaySegment(parts.accountSuffix),
    };
  }
  if (m === "cbebirr") {
    return {
      receiptNumber: sanitizePaySegment(parts.receiptNumber),
      phoneNumber: normalizeEthiopiaPhone(parts.phoneNumber),
    };
  }
  if (m === "telebirr") {
    return { reference: sanitizePaySegment(parts.reference) };
  }
  return null;
}

/**
 * POST /api/player/wallet/online-deposit
 * Body: { method, amount, smsText?, reference?, accountSuffix?, receiptNumber?, phoneNumber? }
 */
export async function verifyOnlineDeposit(req, res) {
  try {
    if (req.user?.role !== "PLAYER") {
      return res.status(403).json({
        message:
          "Online deposit is only for player accounts. Sign in with your player phone.",
      });
    }

    if (!isPaymentVerifyConfigured()) {
      return res.status(503).json({
        message: "Online deposit is temporarily unavailable.",
      });
    }

    const body = req.body ?? {};
    const methodRaw = String(body.method ?? "").toLowerCase();
    const amountNum = Number(body.amount);

    if (!isOnlinePayMethod(methodRaw)) {
      return res.status(400).json({
        message: 'method must be one of: "cbe", "cbebirr", "telebirr"',
      });
    }

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res
        .status(400)
        .json({ message: "amount must be a positive number" });
    }

    const limits = await resolveBettingLimits(prisma);
    const depErr = getDepositAmountViolation(limits, amountNum);
    if (depErr) {
      return res.status(400).json({ message: depErr });
    }

    const parts = {
      reference: body.reference,
      accountSuffix: body.accountSuffix,
      receiptNumber: body.receiptNumber,
      phoneNumber: body.phoneNumber,
    };

    const smsText = String(body.smsText ?? "").trim();

    if (smsText) {
      const extracted = extractOnlineDepositFromSms(methodRaw, smsText);
      if (methodRaw === "cbe" || methodRaw === "telebirr") {
        if (!extracted.ok) {
          return res.status(400).json({ message: extracted.message });
        }
        if (methodRaw === "cbe") {
          parts.reference = extracted.reference;
          parts.accountSuffix = extracted.accountSuffix;
        } else {
          parts.reference = extracted.reference;
        }
      } else if (methodRaw === "cbebirr") {
        if (extracted.ok && "receiptNumber" in extracted) {
          parts.receiptNumber = extracted.receiptNumber;
          if (extracted.phoneNumber) {
            parts.phoneNumber = extracted.phoneNumber;
          }
        } else {
          return res.status(400).json({
            message:
              extracted.message ||
              "Could not read CBE Birr transaction details from SMS.",
          });
        }
      }
    }

    if (methodRaw === "telebirr" || methodRaw === "cbe") {
      if (!sanitizePaySegment(parts.reference)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read reference from SMS."
            : "reference is required (or paste full SMS).",
        });
      }
    }
    if (methodRaw === "cbe") {
      if (!sanitizePaySegment(parts.accountSuffix)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read account suffix from SMS."
            : "accountSuffix is required (or paste full SMS).",
        });
      }
    }
    if (methodRaw === "cbebirr") {
      if (!sanitizePaySegment(parts.receiptNumber)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read receipt number from SMS (or paste a message that includes Txn ID / invoice link)."
            : "receiptNumber is required (or paste full SMS).",
        });
      }
      if (!normalizeEthiopiaPhone(parts.phoneNumber)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read phone from SMS; include the full message with the invoice link (PH=)."
            : "phoneNumber is required (or paste full SMS with invoice link).",
        });
      }
    }

    const ledgerRef = buildOnlinePayLedgerReference(methodRaw, {
      reference: parts.reference,
      accountSuffix: parts.accountSuffix,
      receiptNumber: parts.receiptNumber,
      phoneNumber: parts.phoneNumber,
    });
    if (!ledgerRef) {
      return res
        .status(400)
        .json({ message: "Could not build payment reference" });
    }

    const remoteBody = remotePayloadForMethod(methodRaw, parts);
    if (!remoteBody) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const remote = await verifyPaymentRemote(methodRaw, remoteBody);

    if (!remote.ok) {
      const msg =
        (typeof remote.data?.message === "string" && remote.data.message) ||
        (typeof remote.data?.error === "string" && remote.data.error) ||
        "Payment verification failed";
      return res.status(400).json({ message: msg });
    }

    const data = remote.data;
    if (!isSuccessfulVerification(methodRaw, data)) {
      return res.status(400).json({
        message: "Payment could not be verified as completed",
      });
    }

    const receiversRow = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const receiversCfg = parseReceiversSetting(receiversRow?.value);
    if (!verifyResponseMatchesReceivers(methodRaw, receiversCfg, data)) {
      return res.status(400).json({
        message: "Payment recipient does not match platform deposit details.",
      });
    }

    const verifiedAmount = parseVerifiedAmountEtb(methodRaw, data);
    if (verifiedAmount == null || !Number.isFinite(verifiedAmount)) {
      return res.status(400).json({
        message: "Could not read verified amount from payment provider",
      });
    }

    if (!amountsMatch(amountNum, verifiedAmount)) {
      return res.status(400).json({
        message:
          "Amount does not match verification. Check the transaction or amount entered.",
      });
    }

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });
    if (!wallet) {
      return res.status(400).json({ message: "Player wallet not found" });
    }

    const creditAmount = verifiedAmount;

    // Check if this payment reference was already used (defense-in-depth)
    const existingTx = await prisma.transaction.findFirst({
      where: { reference: ledgerRef },
      select: { id: true },
    });
    if (existingTx) {
      return res.status(409).json({
        message: "This payment was already used for a deposit.",
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const w = await tx.wallet.findUnique({ where: { id: wallet.id } });
        if (!w) throw new Error("WALLET_GONE");

        const userRow = await tx.user.findUnique({
          where: { id: w.user_id },
          select: { first_deposit_at: true },
        });
        const hadFirst = userRow?.first_deposit_at ?? null;

        const credited = await creditWallet(tx, w, creditAmount, {
          withdrawable: false,
        });

        const depRow = await tx.transaction.create({
          data: {
            wallet_id: w.id,
            type: "DEPOSIT",
            amount: creditAmount,
            balance_before: credited.balanceBefore,
            balance_after: credited.balanceAfter,
            reference: ledgerRef,
          },
        });

        await applyDepositBonusesInTx(tx, {
          walletId: w.id,
          depositAmount: creditAmount,
          playerDepositTxId: depRow.id,
          hadFirstDepositAt: hadFirst,
        });

        if (!hadFirst) {
          await tx.user.update({
            where: { id: w.user_id },
            data: { first_deposit_at: new Date() },
          });
        }

        const wFinal = await tx.wallet.findUnique({ where: { id: w.id } });
        return {
          newBalance: Number(wFinal?.balance ?? credited.balanceAfter),
          creditedAmount: creditAmount,
        };
      });

      const depMsg = depositNotification({
        amount: result.creditedAmount,
        source: "online",
      });
      void notifyUserSafe({
        userId: req.user.sub,
        ...depMsg,
      });

      return res.status(200).json({
        ok: true,
        newBalance: result.newBalance,
        creditedAmount: result.creditedAmount,
        reference: ledgerRef,
        verifySummary: verifySummaryFromResponse(methodRaw, data),
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "This payment was already used for a deposit.",
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("verifyOnlineDeposit error:", error);
    return res
      .status(500)
      .json({ message: "Failed to process online deposit" });
  }
}
