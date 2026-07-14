/**
 * InOut Games webhook controller.
 *
 * Single entry point for the seamless-wallet webhooks. The signature has
 * already been verified and the JSON parsed by `middleware/inoutWebhook.js`
 * (available as `req.inoutBody`).
 *
 * Response contract:
 *   - Success: HTTP 200 with `{ code: "OK", ... }`.
 *   - Error:   non-200 with `{ code, message }` (InOut treats any non-200 as an
 *     error, even if `code` is OK).
 *
 * Idempotency for withdraw/rollback is enforced in `services/inoutWallet.js`
 * via the unique ledger reference; a replay returns the previously recorded
 * balance.
 *
 * @module controllers/inoutWebhookController
 */
import { prisma } from "../Config/db.js";
import { getInoutOperatorId, INOUT_DEFAULT_CURRENCY } from "../Config/inout.js";
import { formatEtb } from "../lib/inoutMoney.js";
import {
  debitForBet,
  creditForWithdraw,
  refundForRollback,
} from "../services/inoutWallet.js";

/** InOut error codes with default HTTP statuses. */
const ERROR_HTTP = {
  TEMPORARY_ERROR: 503,
  INVALID_TOKEN: 401,
  ACCOUNT_LOCKED: 403,
  ACCOUNT_INVALID: 404,
  UNKNOWN_ERROR: 500,
  GAME_DISABLED: 400,
  INSUFFICIENT_FUNDS: 400,
  CHECKS_FAIL: 400,
  DEBIT_TRANSACTION_NOT_FOUND: 404,
};

function sendError(res, code, message) {
  const status = ERROR_HTTP[code] ?? 400;
  return res.status(status).json(message ? { code, message } : { code });
}

/**
 * Resolve a session token to its user + PLAYER wallet balance.
 * @param {string} token
 */
async function resolveSession(token) {
  if (!token) return { error: "INVALID_TOKEN" };

  const session = await prisma.inoutGameSession.findUnique({
    where: { token },
  });
  if (!session) return { error: "INVALID_TOKEN" };

  const user = await prisma.user.findUnique({
    where: { id: session.user_id },
    include: { role: true },
  });
  if (!user) return { error: "ACCOUNT_INVALID" };
  if (user.status === false) return { error: "ACCOUNT_LOCKED" };

  const wallet = await prisma.wallet.findFirst({
    where: { user_id: user.id, wallet_type: "PLAYER" },
  });
  if (!wallet) return { error: "ACCOUNT_INVALID" };

  return { session, user, wallet };
}

/** Reject currencies we do not support (wallet is ETB-only). */
function currencyAllowed(currency) {
  if (!currency) return true;
  return String(currency).toUpperCase() === INOUT_DEFAULT_CURRENCY;
}

async function handleInit(body, res) {
  const token = body?.token;
  const resolved = await resolveSession(token);
  if (resolved.error) return sendError(res, resolved.error);

  const { user, wallet } = resolved;
  return res.status(200).json({
    code: "OK",
    userId: user.id,
    nickname: user.fullname || user.username || user.id,
    balance: formatEtb(wallet.balance),
    currency: INOUT_DEFAULT_CURRENCY,
    operator: getInoutOperatorId(),
  });
}

async function handleBet(body, res) {
  const token = body?.token;
  const data = body?.data ?? {};
  const { transactionId, amount, currency } = data;

  if (!transactionId) return sendError(res, "UNKNOWN_ERROR", "Missing transactionId");
  if (!currencyAllowed(currency)) return sendError(res, "CHECKS_FAIL", "Unsupported currency");

  const resolved = await resolveSession(token);
  if (resolved.error) return sendError(res, resolved.error);

  const result = await debitForBet(resolved.user.id, amount, transactionId);
  switch (result.status) {
    case "ok":
    case "duplicate":
      return res.status(200).json({ code: "OK", balance: formatEtb(result.balance) });
    case "insufficient_funds":
      return sendError(res, "INSUFFICIENT_FUNDS");
    case "no_wallet":
      return sendError(res, "ACCOUNT_INVALID");
    default:
      return sendError(res, "UNKNOWN_ERROR");
  }
}

async function handleWithdraw(body, res) {
  const token = body?.token;
  const data = body?.data ?? {};
  const { transactionId, result: resultAmount, currency, debitId } = data;

  if (!transactionId) return sendError(res, "UNKNOWN_ERROR", "Missing transactionId");
  if (!currencyAllowed(currency)) return sendError(res, "CHECKS_FAIL", "Unsupported currency");

  const resolved = await resolveSession(token);
  if (resolved.error) return sendError(res, resolved.error);

  const out = await creditForWithdraw(resolved.user.id, resultAmount ?? 0, transactionId, debitId);
  if (out.status === "no_wallet") return sendError(res, "ACCOUNT_INVALID");
  if (out.status === "debit_not_found") return sendError(res, "DEBIT_TRANSACTION_NOT_FOUND");
  if (out.status !== "ok" && out.status !== "duplicate") {
    return sendError(res, "UNKNOWN_ERROR");
  }
  return res.status(200).json({ code: "OK", balance: formatEtb(out.balance) });
}

async function handleRollback(body, res) {
  const token = body?.token;
  const data = body?.data ?? {};
  const { transactionId, amount, currency, debitId } = data;

  if (!transactionId) return sendError(res, "UNKNOWN_ERROR", "Missing transactionId");
  if (!currencyAllowed(currency)) return sendError(res, "CHECKS_FAIL", "Unsupported currency");

  const resolved = await resolveSession(token);
  if (resolved.error) return sendError(res, resolved.error);

  const out = await refundForRollback(resolved.user.id, amount ?? 0, transactionId, debitId);
  if (out.status === "no_wallet") return sendError(res, "ACCOUNT_INVALID");
  if (out.status === "debit_not_found") return sendError(res, "DEBIT_TRANSACTION_NOT_FOUND");
  if (out.status !== "ok" && out.status !== "duplicate") {
    return sendError(res, "UNKNOWN_ERROR");
  }
  return res.status(200).json({ code: "OK", balance: formatEtb(out.balance) });
}

/**
 * Bonus webhooks are acknowledged so the provider does not retry, but no bonus
 * ledger movement happens yet (bonus API is a later phase). We return the
 * player's current balance for a well-formed response.
 */
async function handleBonusAck(body, res) {
  const resolved = await resolveSession(body?.token);
  if (resolved.error) {
    // Still acknowledge to stop retries; balance unknown.
    return res.status(200).json({ code: "OK" });
  }
  return res.status(200).json({
    code: "OK",
    balance: formatEtb(resolved.wallet.balance),
  });
}

/**
 * POST /api/integrations/inout/webhook
 * @type {import("express").RequestHandler}
 */
export async function handleInoutWebhook(req, res) {
  const body = req.inoutBody ?? {};
  const action = body?.action;

  try {
    switch (action) {
      case "init":
        return await handleInit(body, res);
      case "bet":
        return await handleBet(body, res);
      case "withdraw":
        return await handleWithdraw(body, res);
      case "rollback":
        return await handleRollback(body, res);
      case "bonus-complete":
      case "bonus-expired-when-active":
        return await handleBonusAck(body, res);
      default:
        return sendError(res, "UNKNOWN_ERROR", `Unsupported action: ${action}`);
    }
  } catch (err) {
    console.error("[inout] webhook error:", err);
    // Signal a retryable error so the provider's resend mechanism can recover.
    return sendError(res, "TEMPORARY_ERROR", "Temporary processing error");
  }
}
