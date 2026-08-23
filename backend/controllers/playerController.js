/**
 * Player-facing controller — register, own tickets, wallet balance + history.
 *
 * All endpoints assume `authenticateToken` is applied at the router level
 * (except `register` which is public). Ticket and wallet queries are always
 * scoped to `req.user.sub` so players can only see their own data.
 *
 * @module controllers/playerController
 */
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../Config/db.js";
import {
  resolveBettingLimits,
  getWithdrawAmountViolation,
} from "../lib/bettingLimits.js";
import { resolveCancelWindowMinutes } from "../lib/ticketCancelWindow.js";
import { refundTicketStakeInTx } from "../services/ticketCancelRefund.js";
import { ticketWinningsTaxBreakdown } from "../lib/winningsTax.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { notifyUserSafe } from "../lib/createNotification.js";
import { withdrawPendingNotification } from "../lib/notificationMessages.js";
import {
  SHOP_WITHDRAW_REF_PREFIX,
  SHOP_WITHDRAW_TTL_MS,
  digestShopWithdrawCode,
  generateSixDigitCode,
} from "../lib/shopWithdraw.js";
import { toMoney } from "../lib/moneyDecimal.js";
import { syncPlayerWithdrawableIfNeeded } from "../lib/syncWithdrawable.js";
import {
  creditBonusIfNew,
  computeWelcomeFlatAmount,
  getActiveBonus,
  welcomeBonusRef,
} from "../lib/bonusEngine.js";
import { normalizeEthiopiaPhone } from "../lib/phone.js";
import { uniqueViolationMentions } from "../lib/sparseUserFields.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

function cancelSelectionKickoffTime(selection) {
  return (
    selection.match?.start_time ?? selection.fixture?.start_time ?? null
  );
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * POST /api/auth/register
 * Public — creates a PLAYER user + wallet.
 * Body: { fullname, phone, password }
 */
export async function register(req, res) {
  try {
    const { fullname, phone, password } = req.body ?? {};

    if (!fullname || !phone || !password) {
      return res
        .status(400)
        .json({ message: "fullname, phone and password are required" });
    }

    if (String(password).length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const playerRole = await prisma.role.findUnique({
      where: { name: "PLAYER" },
    });

    if (!playerRole) {
      return res
        .status(500)
        .json({ message: "PLAYER role not found — run prisma db seed" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const phoneNorm = normalizeEthiopiaPhone(phone);

    const user = await prisma.$transaction(async (tx) => {
      // Omit `username` entirely — do not write `null`. Sparse unique indexes
      // on username still index null values and would reject every later player.
      const newUser = await tx.user.create({
        data: {
          fullname: String(fullname).trim(),
          phone: phoneNorm,
          email: `${phoneNorm}@player.local`,
          password: hashedPassword,
          role_id: playerRole.id,
          status: true,
        },
        include: { role: true },
      });

      const newWallet = await tx.wallet.create({
        data: {
          user_id: newUser.id,
          wallet_type: "PLAYER",
          balance: 0,
        },
      });

      const welcomeB = await getActiveBonus(tx, "WELCOME");
      const welcomeAmt = computeWelcomeFlatAmount(welcomeB);
      if (welcomeAmt > 0) {
        await creditBonusIfNew(tx, {
          walletId: newWallet.id,
          amount: welcomeAmt,
          reference: welcomeBonusRef(newUser.id),
        });
      }

      return newUser;
    });

    const accessToken = jwt.sign(
      {
        sub: user.id,
        phone: user.phone,
        username: null,
        role: user.role.name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    return res.status(201).json({
      accessToken,
      user: {
        id: user.id,
        username: null,
        fullname: user.fullname,
        phone: user.phone,
        role: user.role.name,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      if (
        uniqueViolationMentions(error, "phone") ||
        uniqueViolationMentions(error, "email")
      ) {
        return res
          .status(409)
          .json({ message: "Phone number already registered" });
      }
      console.error("register unique violation:", error?.meta ?? error);
      return res.status(409).json({ message: "Account already exists" });
    }
    console.error("register error:", error);
    return res.status(500).json({ message: "Registration failed" });
  }
}

/**
 * GET /api/player/tickets
 * Paginated list of the authenticated player's own tickets.
 */
export async function listOwnTickets(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const status = String(req.query.status || "").trim();

    const where = { user_id: req.user.sub };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          selections: {
            include: {
              match: true,
              fixture: {
                include: { home_team: true, away_team: true },
              },
            },
          },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    return res.json({
      items: items.map(mapPlayerTicket),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listOwnTickets error:", error);
    return res.status(500).json({ message: "Failed to list tickets" });
  }
}

/**
 * GET /api/player/tickets/:id
 * Single ticket detail — only if it belongs to the authenticated player.
 */
export async function getOwnTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, user_id: req.user.sub },
      include: {
        selections: {
          include: {
            match: true,
            fixture: {
              include: { home_team: true, away_team: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    return res.json(mapPlayerTicket(ticket));
  } catch (error) {
    console.error("getOwnTicket error:", error);
    return res.status(500).json({ message: "Failed to get ticket" });
  }
}

/**
 * GET /api/player/wallet
 * Returns the player's wallet balance and type.
 */
export async function getWallet(req, res) {
  try {
    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Self-heal: if casino/sportsbook wins landed on balance but withdrawable
    // stayed 0, recompute from mrx:win / inout:withdraw / win-settlement ledger.
    const synced = await syncPlayerWithdrawableIfNeeded(prisma, wallet);

    return res.json({
      id: wallet.id,
      balance: synced.balance,
      withdrawable: synced.withdrawable,
      walletType: wallet.wallet_type,
    });
  } catch (error) {
    console.error("getWallet error:", error);
    return res.status(500).json({ message: "Failed to get wallet" });
  }
}

/**
 * GET /api/player/wallet/history
 * Paginated transaction history for the player's wallet.
 */
export async function getWalletHistory(req, res) {
  try {
    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const where = { wallet_id: wallet.id };

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
 * POST /api/player/wallet/shop-withdraw
 * Body: { amount } — creates a pending withdrawal and returns a single-use 6-digit code.
 */
export async function createShopWithdraw(req, res) {
  try {
    if (req.user?.role !== "PLAYER") {
      return res.status(403).json({
        message:
          "Shop withdrawal is only for player accounts. Sign in with your player phone, not a staff/cashier login.",
      });
    }

    const { amount } = req.body ?? {};
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const limits = await resolveBettingLimits(prisma);
    const withdrawViolation = getWithdrawAmountViolation(limits, numericAmount);
    if (withdrawViolation) {
      return res.status(400).json({ message: withdrawViolation });
    }

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });
    if (!wallet) {
      return res.status(400).json({
        message:
          "No player wallet on this account. Use a player login, or contact support if your wallet is missing.",
      });
    }

    const synced = await syncPlayerWithdrawableIfNeeded(prisma, wallet);
    const balance = synced.balance;
    const withdrawable = synced.withdrawable;
    if (balance < numericAmount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }
    if (withdrawable < numericAmount) {
      return res.status(400).json({
        message: `Withdrawable balance is ${withdrawable} ETB. Only winnings are withdrawable; unused deposits stay locked.`,
      });
    }

    const intentId = crypto.randomUUID();
    const code = generateSixDigitCode();
    const codeDigest = digestShopWithdrawCode(code);
    const expiresAt = new Date(Date.now() + SHOP_WITHDRAW_TTL_MS);

    // Sequential writes (no interactive transaction): Prisma Mongo transactions require a
    // replica set; standalone or misconfigured Mongo causes $transaction to throw.
    const pendingTx = await prisma.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "WITHDRAW",
        amount: numericAmount,
        balance_before: balance,
        balance_after: balance,
        reference: `${SHOP_WITHDRAW_REF_PREFIX}${intentId}`,
      },
    });

    try {
      await prisma.shopWithdrawIntent.create({
        data: {
          id: intentId,
          user_id: req.user.sub,
          transaction_id: pendingTx.id,
          amount: numericAmount,
          code_digest: codeDigest,
          expires_at: expiresAt,
        },
      });
    } catch (intentErr) {
      await prisma.transaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
      throw intentErr;
    }

    const pendingMsg = withdrawPendingNotification({ amount: numericAmount });
    void notifyUserSafe({ userId: req.user.sub, ...pendingMsg });

    return res.status(201).json({
      code,
      expiresAt: expiresAt.toISOString(),
      amount: numericAmount,
    });
  } catch (error) {
    console.error("createShopWithdraw error:", error);
    return res.status(500).json({ message: "Failed to create shop withdrawal code" });
  }
}

/**
 * PATCH /api/player/tickets/:id/cancel
 * Player cancels own OPEN/PRINTED ticket within the admin cancel window; refunds
 * wallet debit from online placement when present (unique `bet-cancel:${id}` ref).
 */
export async function cancelOwnPlayerTicket(req, res) {
  try {
    const ticketId = req.params.id;

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, user_id: req.user.sub },
      include: {
        selections: {
          include: {
            match: true,
            fixture: { include: { home_team: true, away_team: true } },
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status !== "OPEN" && ticket.status !== "PRINTED") {
      return res.status(400).json({
        message: "Only OPEN or PRINTED tickets can be canceled",
      });
    }

    const now = new Date();
    const cancelWindowMinutes = await resolveCancelWindowMinutes(prisma);
    const windowEndsAt = new Date(
      ticket.created_at.getTime() + cancelWindowMinutes * 60 * 1000,
    );

    if (now > windowEndsAt) {
      return res.status(400).json({
        message: "Ticket cancellation window has passed",
      });
    }

    const anyStarted = ticket.selections.some((selection) => {
      const kickoff = cancelSelectionKickoffTime(selection);
      if (!kickoff) return false;
      return kickoff <= now;
    });

    if (anyStarted) {
      return res.status(400).json({
        message: "Cannot cancel ticket because at least one match has started",
      });
    }

    let outcomeKind = "error";
    try {
      outcomeKind = await prisma.$transaction(async (tx) => {
        const locked = await tx.ticket.findUnique({
          where: { id: ticketId },
        });
        if (
          !locked ||
          locked.user_id !== req.user.sub ||
          (locked.status !== "OPEN" && locked.status !== "PRINTED")
        ) {
          return "not_cancelable";
        }

        await refundTicketStakeInTx(tx, locked);

        const setCanceled = await tx.ticket.updateMany({
          where: {
            id: ticketId,
            user_id: req.user.sub,
            status: { in: ["OPEN", "PRINTED"] },
          },
          data: { status: "CANCELED" },
        });

        if (setCanceled.count === 0) {
          return "not_cancelable";
        }

        return "ok";
      });
    } catch (txErr) {
      console.error("cancelOwnPlayerTicket transaction:", txErr);
      return res.status(500).json({ message: "Failed to cancel ticket" });
    }

    if (outcomeKind !== "ok") {
      return res.status(409).json({
        message: "Ticket is already canceled or cannot be canceled anymore",
      });
    }

    await logAuditEvent({
      req,
      action: "TICKET_CANCELED_PLAYER",
      module: "TICKETS",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: "CANCELED" },
    });

    return res.json({
      message: "Ticket canceled successfully",
      ticket: { id: ticket.id, status: "CANCELED" },
    });
  } catch (error) {
    console.error("cancelOwnPlayerTicket error:", error);
    return res.status(500).json({ message: "Failed to cancel ticket" });
  }
}

/** Human label for bet history / receipts when snapshot marketLabel is missing */
function formatMarketLabelFromCode(code, params) {
  const c = String(code || "").trim().toUpperCase();
  const p = params && typeof params === "object" ? params : {};
  const lineFromParams = () => {
    for (const key of ["line", "handicap", "value"]) {
      const n = Number(p[key]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  switch (c) {
    case "MATCH_WINNER":
      return "Match result";
    case "DOUBLE_CHANCE":
      return "Double chance";
    case "OVER_UNDER": {
      const line = lineFromParams();
      return line != null ? `Over/Under ${line}` : "Over/Under";
    }
    case "BTTS":
      return "Both teams to score";
    case "HANDICAP": {
      const line = lineFromParams();
      return line != null ? `Handicap ${line}` : "Handicap";
    }
    default:
      if (!c) return "";
      return c
        .toLowerCase()
        .split(/_+/g)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

function resolveSelectionMarketLabel(snapshotEntry, selectionRow) {
  const fromSnap = String(snapshotEntry?.marketLabel ?? "").trim();
  if (fromSnap) return fromSnap;
  return formatMarketLabelFromCode(
    selectionRow?.market_code,
    selectionRow?.market_params,
  );
}

/** Split "Home vs Away" or "Home V Away" (live list / fixture mapper) for bet history. */
function parseMatchNameTeams(matchName) {
  const text = String(matchName || "").trim();
  if (!text) return { homeTeam: "Match", awayTeam: "" };

  const vsSplit = text.split(/\s+vs\s+/i);
  if (vsSplit.length >= 2) {
    return {
      homeTeam: String(vsSplit[0] || "").trim() || "Match",
      awayTeam: String(vsSplit.slice(1).join(" vs ") || "").trim(),
    };
  }

  const vSplit = text.split(/\s+V\s+/);
  if (vSplit.length >= 2) {
    return {
      homeTeam: String(vSplit[0] || "").trim() || "Match",
      awayTeam: String(vSplit.slice(1).join(" V ") || "").trim(),
    };
  }

  return { homeTeam: text, awayTeam: "" };
}

function mapPlayerTicket(ticket) {
  const snapshotRows = Array.isArray(ticket.selection_snapshot)
    ? ticket.selection_snapshot
    : [];

  const normalSelections =
    ticket.selections?.map((s, index) => {
      let matchSummary = s.match
        ? {
            id: s.match.id,
            homeTeam: s.match.home_team,
            awayTeam: s.match.away_team,
            startTime: s.match.start_time,
            status: s.match.status,
          }
        : s.fixture
          ? {
              id: s.fixture.id,
              homeTeam: s.fixture.home_team?.name || "Home",
              awayTeam: s.fixture.away_team?.name || "Away",
              startTime: s.fixture.start_time,
              status: s.fixture.status,
              homeScore: s.fixture.home_score,
              awayScore: s.fixture.away_score,
            }
          : null;

      const snapName = String(snapshotRows[index]?.matchName ?? "").trim();
      if (!matchSummary && snapName) {
        const teams = parseMatchNameTeams(snapName);
        matchSummary = {
          id: null,
          homeTeam: teams.homeTeam,
          awayTeam: teams.awayTeam,
          startTime: null,
          status: "NOT_STARTED",
        };
      }

      return {
        id: s.id,
        matchId: s.match_id,
        fixtureId: s.fixture_id,
        selection: s.selection,
        marketCode: s.market_code,
        marketParams: s.market_params,
        marketLabel: resolveSelectionMarketLabel(snapshotRows[index], s),
        odds: s.odds,
        result: s.result,
        match: matchSummary,
      };
    }) ?? [];

  const snapshotSelections =
    normalSelections.length === 0 && Array.isArray(ticket.selection_snapshot)
      ? ticket.selection_snapshot.map((entry, index) => ({
          id: `snapshot-${ticket.id}-${index + 1}`,
          matchId: null,
          fixtureId: null,
          selection: String(entry?.label || ""),
          marketCode: entry?.marketCode || null,
          marketParams: entry?.marketParams || null,
          marketLabel:
            String(entry?.marketLabel ?? "").trim() ||
            formatMarketLabelFromCode(entry?.marketCode, entry?.marketParams),
          odds: Number(entry?.odds || 0),
          result: "PENDING",
          match: {
            id: null,
            homeTeam: String(entry?.matchName || "Match"),
            awayTeam: "",
            startTime: null,
            status: "NOT_STARTED",
          },
        }))
      : [];

  const taxBreakdown = ticketWinningsTaxBreakdown(ticket);

  return {
    id: ticket.id,
    couponNumber: ticket.coupon_number,
    receiptNumber: ticket.receipt_number ?? null,
    stake: ticket.stake,
    totalOdds: ticket.total_odds,
    potentialWin: ticket.potential_win,
    applyWinningsTax: Boolean(ticket.apply_winnings_tax),
    winningsTaxRate: ticket.winnings_tax_rate ?? null,
    winningsTaxAmount: taxBreakdown.taxAmount,
    netPayout: taxBreakdown.netPayout,
    status: ticket.status,
    createdAt: ticket.created_at,
    paidAt: ticket.paid_at ?? null,
    selections: normalSelections.length > 0 ? normalSelections : snapshotSelections,
  };
}
