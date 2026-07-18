/**
 * Agents & Cashiers controller.
 *
 * Dedicated endpoints for the "Agents & Cashiers" admin page:
 *  - List cashiers (with wallet balance, branch (text), assigned agent)
 *  - Create cashier (user + wallet + cashier profile with branch text fields)
 *  - List agents (with their assigned cashiers)
 *  - Assign / unassign agent ↔ cashier (one agent per cashier)
 *
 * @module controllers/agentsCashiersController
 */
import bcrypt from "bcrypt";
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { normalizePhoneOrNull } from "../lib/phone.js";
import { unsetUserFields } from "../lib/sparseUserFields.js";
import { validateUsername } from "../lib/username.js";

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function mapCashierBranch(cashierProfile) {
  if (!cashierProfile) return null;
  return {
    name: cashierProfile.branch_name ?? "",
    location: cashierProfile.branch_location ?? "",
  };
}

function userSearchOr(search) {
  return [
    { fullname: { contains: search, mode: "insensitive" } },
    { username: { contains: search, mode: "insensitive" } },
    { phone: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
  ];
}

function mapStaffUser(u) {
  return {
    id: u.id,
    username: u.username ?? null,
    fullname: u.fullname,
    email: u.email,
    phone: u.phone,
    status: u.status,
  };
}

function mapAgentBrief(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    username: agent.username ?? null,
    fullname: agent.fullname,
  };
}

// ─── Cashiers ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/agents-cashiers/cashiers
 * Returns cashiers with user info, branch (text fields), wallet balance, and
 * the currently assigned agent (if any).
 */
export async function listCashiers(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const search = String(req.query.search || "").trim();
    const skip = (page - 1) * limit;

    const where = {
      role: { name: "CASHIER" },
    };

    if (search) {
      where.OR = userSearchOr(search);
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          role: true,
          cashier_profile: {
            include: {
              wallet: true,
              agent_assignments: {
                include: {
                  agent: {
                    select: { id: true, username: true, fullname: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const items = users.map((u) => {
      const cp = u.cashier_profile;
      const agentAssignment = cp?.agent_assignments?.[0];
      return {
        ...mapStaffUser(u),
        createdAt: u.created_at,
        branch: mapCashierBranch(cp),
        wallet: cp?.wallet
          ? { id: cp.wallet.id, balance: Number(cp.wallet.balance) }
          : null,
        agent: mapAgentBrief(agentAssignment?.agent),
        cashierProfileId: cp?.id ?? null,
      };
    });

    return res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listCashiers error:", error);
    return res.status(500).json({ message: "Failed to list cashiers" });
  }
}

/** GET /api/admin/agents-cashiers/cashiers/:id */
export async function getCashier(req, res) {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        role: true,
        cashier_profile: {
          include: {
            wallet: true,
            agent_assignments: {
              include: {
                agent: {
                  select: { id: true, username: true, fullname: true },
                },
              },
            },
          },
        },
      },
    });

    if (!u || u.role?.name !== "CASHIER") {
      return res.status(404).json({ message: "Cashier not found" });
    }

    const cp = u.cashier_profile;
    const agentAssignment = cp?.agent_assignments?.[0];

    return res.json({
      ...mapStaffUser(u),
      createdAt: u.created_at,
      branch: mapCashierBranch(cp),
      wallet: cp?.wallet
        ? { id: cp.wallet.id, balance: Number(cp.wallet.balance) }
        : null,
      agent: mapAgentBrief(agentAssignment?.agent),
      cashierProfileId: cp?.id ?? null,
    });
  } catch (error) {
    console.error("getCashier error:", error);
    return res.status(500).json({ message: "Failed to load cashier" });
  }
}

/**
 * POST /api/admin/agents-cashiers/cashiers
 * Creates user (CASHIER) + wallet + cashier profile (with branch text fields).
 * Body: { username, fullname, email, phone, password, branchName, branchLocation, status? }
 */
export async function createCashier(req, res) {
  try {
    const {
      username,
      fullname,
      email,
      phone,
      password,
      branchName,
      branchLocation,
      status = true,
    } = req.body ?? {};

    const usernameResult = validateUsername(username);
    if (!usernameResult.ok) {
      return res.status(400).json({ message: usernameResult.message });
    }

    if (!fullname || !email || !password || !branchName || !branchLocation) {
      return res.status(400).json({
        message:
          "fullname, email, password, branchName, and branchLocation are required",
      });
    }

    const cashierRole = await prisma.role.findUnique({
      where: { name: "CASHIER" },
    });
    if (!cashierRole)
      return res.status(500).json({ message: "CASHIER role missing" });

    const hashed = await bcrypt.hash(password, 10);

    const phoneNorm = normalizePhoneOrNull(phone);
    const user = await prisma.$transaction(async (tx) => {
      const createData = {
        username: usernameResult.username,
        fullname: String(fullname).trim(),
        email: String(email).toLowerCase().trim(),
        password: hashed,
        role_id: cashierRole.id,
        status: Boolean(status),
      };
      if (phoneNorm) createData.phone = phoneNorm;

      const created = await tx.user.create({
        data: createData,
      });

      const wallet = await tx.wallet.create({
        data: { user_id: created.id, wallet_type: "CASHIER", balance: 0 },
      });

      await tx.cashier.create({
        data: {
          user_id: created.id,
          wallet_id: wallet.id,
          branch_name: String(branchName).trim(),
          branch_location: String(branchLocation).trim(),
          status: Boolean(status),
        },
      });

      return tx.user.findUnique({
        where: { id: created.id },
        include: {
          role: true,
          cashier_profile: { include: { wallet: true } },
        },
      });
    });

    const cp = user.cashier_profile;
    const createdCashier = {
      ...mapStaffUser(user),
      branch: mapCashierBranch(cp),
      wallet: { id: cp.wallet.id, balance: Number(cp.wallet.balance) },
      agent: null,
      cashierProfileId: cp.id,
    };

    await logAuditEvent({
      req,
      action: "CASHIER_CREATED",
      module: "AGENTS_CASHIERS",
      entityType: "CASHIER",
      entityId: user.id,
      before: null,
      after: createdCashier,
    });

    return res.status(201).json(createdCashier);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this username, email, or phone already exists",
      });
    }
    console.error("createCashier error:", error);
    return res.status(500).json({ message: "Failed to create cashier" });
  }
}

/**
 * PUT /api/admin/agents-cashiers/cashiers/:id
 * Update cashier user info and branch text fields.
 * Body: {
 *   username?, fullname?, email?, phone?, password?,
 *   branchName?, branchLocation?, status?,
 *   wallet? (number - absolute balance, increase-only)
 * }
 */
export async function updateCashier(req, res) {
  try {
    const userId = req.params.id;
    const {
      username,
      fullname,
      email,
      phone,
      password,
      branchName,
      branchLocation,
      status,
      wallet,
    } = req.body ?? {};

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        cashier_profile: { include: { wallet: true } },
      },
    });

    if (!existing || existing.role?.name !== "CASHIER") {
      return res.status(404).json({ message: "Cashier not found" });
    }

    const clearPhone =
      phone !== undefined && !normalizePhoneOrNull(phone);

    await prisma.$transaction(async (tx) => {
      const userData = {};
      if (username !== undefined) {
        const usernameResult = validateUsername(username);
        if (!usernameResult.ok) {
          throw new Error(`USERNAME_INVALID:${usernameResult.message}`);
        }
        userData.username = usernameResult.username;
      }
      if (fullname !== undefined) userData.fullname = String(fullname).trim();
      if (email !== undefined)
        userData.email = String(email).toLowerCase().trim();
      if (phone !== undefined) {
        const phoneNorm = normalizePhoneOrNull(phone);
        if (phoneNorm) userData.phone = phoneNorm;
      }
      if (status !== undefined) userData.status = Boolean(status);
      if (password) userData.password = await bcrypt.hash(password, 10);

      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }

      const cashierData = {};
      if (status !== undefined) cashierData.status = Boolean(status);
      if (branchName !== undefined)
        cashierData.branch_name = String(branchName).trim();
      if (branchLocation !== undefined)
        cashierData.branch_location = String(branchLocation).trim();

      if (Object.keys(cashierData).length > 0 && existing.cashier_profile) {
        await tx.cashier.update({
          where: { user_id: userId },
          data: cashierData,
        });
      }

      if (wallet !== undefined && existing.cashier_profile?.wallet_id) {
        const nextWalletBalance = Number(wallet);
        if (!Number.isFinite(nextWalletBalance) || nextWalletBalance < 0) {
          throw new Error("INVALID_WALLET_BALANCE");
        }

        const currentWallet = await tx.wallet.findUnique({
          where: { id: existing.cashier_profile.wallet_id },
          select: { balance: true },
        });
        const currentBalance = Number(currentWallet?.balance ?? 0);

        if (nextWalletBalance < currentBalance) {
          throw new Error("WALLET_DECREASE_NOT_ALLOWED");
        }

        await tx.wallet.update({
          where: { id: existing.cashier_profile.wallet_id },
          data: { balance: nextWalletBalance },
        });
      }
    });

    if (clearPhone) {
      await unsetUserFields(prisma, userId, ["phone"]);
    }

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        cashier_profile: { include: { wallet: true } },
      },
    });

    const beforeSnapshot = {
      ...mapStaffUser(existing),
      branch: mapCashierBranch(existing.cashier_profile),
      wallet: existing.cashier_profile?.wallet
        ? {
            id: existing.cashier_profile.wallet.id,
            balance: Number(existing.cashier_profile.wallet.balance),
          }
        : null,
    };
    const afterSnapshot = updated
      ? {
          ...mapStaffUser(updated),
          branch: mapCashierBranch(updated.cashier_profile),
          wallet: updated.cashier_profile?.wallet
            ? {
                id: updated.cashier_profile.wallet.id,
                balance: Number(updated.cashier_profile.wallet.balance),
              }
            : null,
        }
      : null;

    await logAuditEvent({
      req,
      action: "CASHIER_UPDATED",
      module: "AGENTS_CASHIERS",
      entityType: "CASHIER",
      entityId: userId,
      before: beforeSnapshot,
      after: afterSnapshot,
    });

    return getCashier({ params: { id: userId } }, res);
  } catch (error) {
    if (String(error?.message || "").startsWith("USERNAME_INVALID:")) {
      return res
        .status(400)
        .json({ message: error.message.replace("USERNAME_INVALID:", "") });
    }
    if (error?.message === "INVALID_WALLET_BALANCE") {
      return res.status(400).json({ message: "Wallet must be a valid amount" });
    }
    if (error?.message === "WALLET_DECREASE_NOT_ALLOWED") {
      return res
        .status(400)
        .json({ message: "Wallet top up can only increase balance" });
    }
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this username, email, or phone already exists",
      });
    }
    console.error("updateCashier error:", error);
    return res.status(500).json({ message: "Failed to update cashier" });
  }
}

/**
 * DELETE /api/admin/agents-cashiers/cashiers/:id
 * Deletes cashier user, their cashier profile, wallet, and agent assignments.
 */
export async function deleteCashier(req, res) {
  try {
    const userId = req.params.id;

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, cashier_profile: true },
    });

    if (!existing || existing.role?.name !== "CASHIER") {
      return res.status(404).json({ message: "Cashier not found" });
    }

    await prisma.$transaction(async (tx) => {
      if (existing.cashier_profile) {
        await tx.agentCashier.deleteMany({
          where: { cashier_id: existing.cashier_profile.id },
        });
        await tx.cashier.delete({ where: { user_id: userId } });
      }

      await tx.wallet.deleteMany({ where: { user_id: userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    await logAuditEvent({
      req,
      action: "CASHIER_DELETED",
      module: "AGENTS_CASHIERS",
      entityType: "CASHIER",
      entityId: userId,
      before: mapStaffUser(existing),
      after: null,
    });

    return res.json({ message: "Cashier deleted" });
  } catch (error) {
    console.error("deleteCashier error:", error);
    return res.status(500).json({ message: "Failed to delete cashier" });
  }
}

// ─── Agents ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/agents-cashiers/agents
 * Creates an AGENT user.
 * Body: { username, fullname, email, phone, password, status?, agentCashierIds?[] }
 */
export async function createAgent(req, res) {
  try {
    const {
      username,
      fullname,
      email,
      phone,
      password,
      status = true,
      agentCashierIds = [],
    } = req.body ?? {};

    const usernameResult = validateUsername(username);
    if (!usernameResult.ok) {
      return res.status(400).json({ message: usernameResult.message });
    }

    if (!fullname || !email || !password) {
      return res
        .status(400)
        .json({ message: "fullname, email, and password are required" });
    }

    const agentRole = await prisma.role.findUnique({
      where: { name: "AGENT" },
    });
    if (!agentRole)
      return res.status(500).json({ message: "AGENT role missing" });

    const hashed = await bcrypt.hash(password, 10);
    const phoneNorm = normalizePhoneOrNull(phone);

    let createdAgentId = null;
    await prisma.$transaction(async (tx) => {
      const createData = {
        username: usernameResult.username,
        fullname: String(fullname).trim(),
        email: String(email).toLowerCase().trim(),
        password: hashed,
        role_id: agentRole.id,
        status: Boolean(status),
      };
      if (phoneNorm) createData.phone = phoneNorm;

      const user = await tx.user.create({
        data: createData,
      });
      createdAgentId = user.id;

      if (Array.isArray(agentCashierIds) && agentCashierIds.length > 0) {
        const unique = [...new Set(agentCashierIds.map(String))];
        for (const cashierId of unique) {
          await tx.agentCashier.deleteMany({
            where: { cashier_id: cashierId },
          });
        }
        await tx.agentCashier.createMany({
          data: unique.map((cid) => ({ agent_id: user.id, cashier_id: cid })),
          skipDuplicates: true,
        });
      }
    });

    if (createdAgentId) {
      await logAuditEvent({
        req,
        action: "AGENT_CREATED",
        module: "AGENTS_CASHIERS",
        entityType: "AGENT",
        entityId: createdAgentId,
        before: null,
        after: {
          id: createdAgentId,
          username: usernameResult.username,
          fullname: String(fullname).trim(),
          email: String(email).toLowerCase().trim(),
          phone: normalizePhoneOrNull(phone),
          status: Boolean(status),
        },
      });
    }

    return res.status(201).json({ message: "Agent created" });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this username, email, or phone already exists",
      });
    }
    console.error("createAgent error:", error);
    return res.status(500).json({ message: "Failed to create agent" });
  }
}

/**
 * PUT /api/admin/agents-cashiers/agents/:id
 * Update agent user info.
 * Body: { username?, fullname?, email?, phone?, password?, status? }
 */
export async function updateAgent(req, res) {
  try {
    const userId = req.params.id;
    const { username, fullname, email, phone, password, status } =
      req.body ?? {};

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!existing || existing.role?.name !== "AGENT") {
      return res.status(404).json({ message: "Agent not found" });
    }

    const data = {};
    const clearPhone =
      phone !== undefined && !normalizePhoneOrNull(phone);
    if (username !== undefined) {
      const usernameResult = validateUsername(username);
      if (!usernameResult.ok) {
        return res.status(400).json({ message: usernameResult.message });
      }
      data.username = usernameResult.username;
    }
    if (fullname !== undefined) data.fullname = String(fullname).trim();
    if (email !== undefined) data.email = String(email).toLowerCase().trim();
    if (phone !== undefined) {
      const phoneNorm = normalizePhoneOrNull(phone);
      if (phoneNorm) data.phone = phoneNorm;
    }
    if (status !== undefined) data.status = Boolean(status);
    if (password) data.password = await bcrypt.hash(password, 10);

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: userId }, data });
    }
    if (clearPhone) {
      await unsetUserFields(prisma, userId, ["phone"]);
    }

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullname: true,
        email: true,
        phone: true,
        status: true,
      },
    });
    await logAuditEvent({
      req,
      action: "AGENT_UPDATED",
      module: "AGENTS_CASHIERS",
      entityType: "AGENT",
      entityId: userId,
      before: mapStaffUser(existing),
      after,
    });

    return res.json({ message: "Agent updated" });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this username, email, or phone already exists",
      });
    }
    console.error("updateAgent error:", error);
    return res.status(500).json({ message: "Failed to update agent" });
  }
}

/**
 * DELETE /api/admin/agents-cashiers/agents/:id
 * Deletes agent user and all their cashier assignments.
 */
export async function deleteAgent(req, res) {
  try {
    const userId = req.params.id;

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!existing || existing.role?.name !== "AGENT") {
      return res.status(404).json({ message: "Agent not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.agentCashier.deleteMany({ where: { agent_id: userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    await logAuditEvent({
      req,
      action: "AGENT_DELETED",
      module: "AGENTS_CASHIERS",
      entityType: "AGENT",
      entityId: userId,
      before: mapStaffUser(existing),
      after: null,
    });

    return res.json({ message: "Agent deleted" });
  } catch (error) {
    console.error("deleteAgent error:", error);
    return res.status(500).json({ message: "Failed to delete agent" });
  }
}

/**
 * GET /api/admin/agents-cashiers/agents
 * Returns agents with their assigned cashiers (with branch text + wallet).
 */
export async function listAgents(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const search = String(req.query.search || "").trim();
    const skip = (page - 1) * limit;

    const where = { role: { name: "AGENT" } };
    if (search) {
      where.OR = userSearchOr(search);
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          role: true,
          agent_assignments: {
            include: {
              cashier: {
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      fullname: true,
                      phone: true,
                    },
                  },
                  wallet: { select: { id: true, balance: true } },
                },
              },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const items = users.map((u) => ({
      ...mapStaffUser(u),
      createdAt: u.created_at,
      cashiers: u.agent_assignments.map((ac) => ({
        assignmentId: ac.id,
        cashierProfileId: ac.cashier.id,
        userId: ac.cashier.user.id,
        username: ac.cashier.user.username ?? null,
        fullname: ac.cashier.user.fullname,
        phone: ac.cashier.user.phone,
        branchName: ac.cashier.branch_name,
        branchLocation: ac.cashier.branch_location,
        walletBalance: Number(ac.cashier.wallet?.balance ?? 0),
      })),
    }));

    return res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listAgents error:", error);
    return res.status(500).json({ message: "Failed to list agents" });
  }
}

// ─── Assignment ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/agents-cashiers/assign
 * Body: { agentId, cashierProfileId }
 * One agent per cashier — removes any previous assignment for that cashier.
 */
export async function assignAgentToCashier(req, res) {
  try {
    const { agentId, cashierProfileId } = req.body ?? {};
    if (!agentId || !cashierProfileId) {
      return res
        .status(400)
        .json({ message: "agentId and cashierProfileId are required" });
    }

    const [agent, cashier] = await Promise.all([
      prisma.user.findUnique({
        where: { id: agentId },
        include: { role: true },
      }),
      prisma.cashier.findUnique({ where: { id: cashierProfileId } }),
    ]);

    if (!agent || agent.role?.name !== "AGENT") {
      return res.status(400).json({ message: "Invalid agent" });
    }
    if (!cashier) {
      return res.status(400).json({ message: "Invalid cashier" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.agentCashier.deleteMany({
        where: { cashier_id: cashierProfileId },
      });
      await tx.agentCashier.create({
        data: { agent_id: agentId, cashier_id: cashierProfileId },
      });
    });

    await logAuditEvent({
      req,
      action: "CASHIER_AGENT_ASSIGNED",
      module: "AGENTS_CASHIERS",
      entityType: "CASHIER",
      entityId: cashierProfileId,
      before: null,
      after: { cashierProfileId, agentId },
    });

    return res.json({ message: "Agent assigned to cashier" });
  } catch (error) {
    console.error("assignAgentToCashier error:", error);
    return res.status(500).json({ message: "Failed to assign agent" });
  }
}

/**
 * DELETE /api/admin/agents-cashiers/assign/:cashierProfileId
 * Removes the agent assignment from a cashier.
 */
export async function unassignAgentFromCashier(req, res) {
  try {
    const { cashierProfileId } = req.params;
    const previousAssignments = await prisma.agentCashier.findMany({
      where: { cashier_id: cashierProfileId },
      select: { id: true, agent_id: true, cashier_id: true },
    });
    await prisma.agentCashier.deleteMany({
      where: { cashier_id: cashierProfileId },
    });

    await logAuditEvent({
      req,
      action: "CASHIER_AGENT_UNASSIGNED",
      module: "AGENTS_CASHIERS",
      entityType: "CASHIER",
      entityId: cashierProfileId,
      before: previousAssignments,
      after: [],
    });

    return res.json({ message: "Agent unassigned from cashier" });
  } catch (error) {
    console.error("unassignAgentFromCashier error:", error);
    return res.status(500).json({ message: "Failed to unassign agent" });
  }
}

/**
 * GET /api/admin/agents-cashiers/assignable-cashiers
 * All cashiers with their currently assigned agent (for assignment dropdowns).
 */
export async function listAssignableCashiers(_req, res) {
  try {
    const cashiers = await prisma.cashier.findMany({
      orderBy: { branch_name: "asc" },
      include: {
        user: {
          select: { id: true, username: true, fullname: true, phone: true },
        },
        wallet: { select: { id: true, balance: true } },
        agent_assignments: {
          include: {
            agent: { select: { id: true, username: true, fullname: true } },
          },
        },
      },
    });

    const items = cashiers.map((c) => ({
      cashierProfileId: c.id,
      userId: c.user.id,
      username: c.user.username ?? null,
      fullname: c.user.fullname,
      phone: c.user.phone,
      branchName: c.branch_name,
      branchLocation: c.branch_location,
      walletBalance: Number(c.wallet?.balance ?? 0),
      agent: mapAgentBrief(c.agent_assignments[0]?.agent),
    }));

    return res.json(items);
  } catch (error) {
    console.error("listAssignableCashiers error:", error);
    return res.status(500).json({ message: "Failed to list cashiers" });
  }
}
