/**
 * Admin users controller — CRUD and listing for `/api/admin/users`.
 *
 * Handles role-specific side effects:
 * - CASHIER: links `Cashier` row with branch text fields + wallet
 * - AGENT: `AgentCashier` assignments for cashier-scoped reports
 *
 * Intended for SUPER_ADMIN / ADMIN only (enforced in routes).
 *
 * @module controllers/usersController
 */
import bcrypt from "bcrypt";
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { normalizePhoneOrNull } from "../lib/phone.js";
import { validateUsername } from "../lib/username.js";

/** Parse query param as positive integer; invalid values fall back to `fallback`. */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Shape Prisma user + relations into a stable API response object. */
function mapUser(user) {
  return {
    id: user.id,
    username: user.username ?? null,
    fullname: user.fullname,
    email: user.email,
    phone: user.phone,
    status: user.status,
    role: user.role?.name ?? null,
    roleId: user.role_id,
    createdAt: user.created_at,
    cashier: user.cashier_profile
      ? {
          id: user.cashier_profile.id,
          branchName: user.cashier_profile.branch_name,
          branchLocation: user.cashier_profile.branch_location,
          walletId: user.cashier_profile.wallet_id,
          status: user.cashier_profile.status,
        }
      : null,
    agentCashiers: user.agent_assignments?.map((item) => ({
      id: item.id,
      cashierProfileId: item.cashier_id,
    })),
  };
}

/**
 * GET /api/admin/users
 * Query: page, limit, search (fullname/username/phone/email), role (RoleName), status (active|disabled)
 */
export async function listUsers(req, res) {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim();
    const status = String(req.query.status || "").trim();
    const skip = (page - 1) * limit;

    const where = {};

    // Case-insensitive partial match on any of these fields
    if (search) {
      where.OR = [
        { fullname: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role) {
      where.role = { name: role };
    }

    if (status === "active") {
      where.status = true;
    } else if (status === "disabled") {
      where.status = false;
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          role: true,
          cashier_profile: true,
          agent_assignments: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return res.json({
      items: items.map(mapUser),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listUsers error:", error);
    return res.status(500).json({ message: "Failed to list users" });
  }
}

/**
 * GET /api/admin/users/meta
 * Dropdown data: all roles + existing cashiers (used for AGENT assignments).
 */
export async function getUsersMeta(_req, res) {
  try {
    const [roles, cashiers] = await Promise.all([
      prisma.role.findMany({ orderBy: { name: "asc" } }),
      prisma.cashier.findMany({
        orderBy: { branch_name: "asc" },
        include: {
          user: { select: { id: true, fullname: true, username: true } },
        },
      }),
    ]);

    return res.json({
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
      cashiers: cashiers.map((c) => ({
        cashierProfileId: c.id,
        fullname: c.user?.fullname ?? "",
        name: c.user?.fullname ?? "",
        username: c.user?.username ?? null,
        branchName: c.branch_name,
        branchLocation: c.branch_location,
      })),
    });
  } catch (error) {
    console.error("getUsersMeta error:", error);
    return res.status(500).json({ message: "Failed to load users metadata" });
  }
}

/**
 * POST /api/admin/users
 * Creates user; CASHIER requires branchName + branchLocation (wallet auto-created);
 * PLAYER gets auto-wallet; AGENT accepts optional agentCashierIds[] (cashier profile ids).
 * Staff require username; players must not have username.
 */
export async function createUser(req, res) {
  try {
    const {
      username,
      fullname,
      email,
      phone,
      password,
      roleId,
      status = true,
      branchName,
      branchLocation,
      agentCashierIds = [],
    } = req.body ?? {};

    if (!fullname || !email || !password || !roleId) {
      return res.status(400).json({
        message: "fullname, email, password and roleId are required",
      });
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return res.status(400).json({ message: "Invalid roleId" });
    }

    if (role.name === "CASHIER" && (!branchName || !branchLocation)) {
      return res.status(400).json({
        message: "branchName and branchLocation are required for CASHIER users",
      });
    }

    let staffUsername = null;
    if (role.name === "PLAYER") {
      if (username != null && String(username).trim()) {
        return res.status(400).json({
          message: "Players cannot have a username",
        });
      }
    } else {
      const validated = validateUsername(username);
      if (!validated.ok) {
        return res.status(400).json({ message: validated.message });
      }
      staffUsername = validated.username;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: staffUsername,
          fullname: String(fullname).trim(),
          email: String(email).toLowerCase().trim(),
          phone: normalizePhoneOrNull(phone),
          password: hashedPassword,
          role_id: roleId,
          status: Boolean(status),
        },
        include: { role: true },
      });

      // CASHIER: auto-create wallet then link via Cashier row
      if (role.name === "CASHIER") {
        const wallet = await tx.wallet.create({
          data: {
            user_id: user.id,
            wallet_type: "CASHIER",
            balance: 0,
          },
        });
        await tx.cashier.create({
          data: {
            user_id: user.id,
            wallet_id: wallet.id,
            branch_name: String(branchName).trim(),
            branch_location: String(branchLocation).trim(),
            status: Boolean(status),
          },
        });
      }

      // PLAYER: auto-create wallet
      if (role.name === "PLAYER") {
        await tx.wallet.create({
          data: {
            user_id: user.id,
            wallet_type: "PLAYER",
            balance: 0,
          },
        });
      }

      // AGENT: assignments to cashier profiles
      if (role.name === "AGENT" && Array.isArray(agentCashierIds)) {
        const uniqueIds = [...new Set(agentCashierIds.map(String))];
        if (uniqueIds.length > 0) {
          // Enforce one agent per cashier
          await tx.agentCashier.deleteMany({
            where: { cashier_id: { in: uniqueIds } },
          });
          await tx.agentCashier.createMany({
            data: uniqueIds.map((id) => ({
              agent_id: user.id,
              cashier_id: id,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.user.findUnique({
        where: { id: user.id },
        include: {
          role: true,
          cashier_profile: true,
          agent_assignments: true,
        },
      });
    });

    const createdUser = mapUser(created);
    await logAuditEvent({
      req,
      action: "USER_CREATED",
      module: "USERS",
      entityType: "USER",
      entityId: createdUser.id,
      before: null,
      after: createdUser,
    });
    return res.status(201).json(createdUser);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this email, phone, or username already exists",
      });
    }

    console.error("createUser error:", error);
    return res.status(500).json({ message: "Failed to create user" });
  }
}

/**
 * PUT /api/admin/users/:id
 * Partial updates; optional password re-hash. Syncs Cashier / AgentCashier when role changes.
 * Auto-creates wallets when switching to CASHIER or PLAYER.
 */
export async function updateUser(req, res) {
  try {
    const userId = req.params.id;
    const {
      username,
      fullname,
      email,
      phone,
      password,
      roleId,
      status,
      branchName,
      branchLocation,
      agentCashierIds,
    } = req.body ?? {};

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, cashier_profile: true, agent_assignments: true },
    });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const nextRoleId = roleId || existingUser.role_id;
    const nextRole = await prisma.role.findUnique({
      where: { id: nextRoleId },
    });
    if (!nextRole) {
      return res.status(400).json({ message: "Invalid roleId" });
    }

    if (nextRole.name === "CASHIER" && !existingUser.cashier_profile) {
      if (!branchName || !branchLocation) {
        return res.status(400).json({
          message:
            "branchName and branchLocation are required for CASHIER users",
        });
      }
    }

    let nextUsername;
    if (nextRole.name === "PLAYER") {
      nextUsername = null;
      if (username != null && String(username).trim()) {
        return res.status(400).json({
          message: "Players cannot have a username",
        });
      }
    } else if (username !== undefined) {
      const validated = validateUsername(username);
      if (!validated.ok) {
        return res.status(400).json({ message: validated.message });
      }
      nextUsername = validated.username;
    } else if (!existingUser.username || existingUser.role.name === "PLAYER") {
      return res.status(400).json({
        message: "Username is required for staff users",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateData = {};

      if (fullname !== undefined) updateData.fullname = String(fullname).trim();
      if (email !== undefined)
        updateData.email = String(email).toLowerCase().trim();
      if (phone !== undefined)
        updateData.phone = normalizePhoneOrNull(phone);
      if (status !== undefined) updateData.status = Boolean(status);
      if (roleId !== undefined) updateData.role_id = String(roleId);
      if (nextUsername !== undefined) updateData.username = nextUsername;
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      await tx.user.update({
        where: { id: userId },
        data: updateData,
      });

      const existingCashier = await tx.cashier.findUnique({
        where: { user_id: userId },
      });

      if (nextRole.name === "CASHIER") {
        let walletId = existingCashier?.wallet_id;
        if (!walletId) {
          const wallet = await tx.wallet.create({
            data: { user_id: userId, wallet_type: "CASHIER", balance: 0 },
          });
          walletId = wallet.id;
        }

        const cashierData = {
          wallet_id: walletId,
          branch_name:
            branchName !== undefined
              ? String(branchName).trim()
              : (existingCashier?.branch_name ?? ""),
          branch_location:
            branchLocation !== undefined
              ? String(branchLocation).trim()
              : (existingCashier?.branch_location ?? ""),
          status:
            status !== undefined
              ? Boolean(status)
              : (existingCashier?.status ?? true),
        };

        if (existingCashier) {
          await tx.cashier.update({
            where: { user_id: userId },
            data: cashierData,
          });
        } else {
          await tx.cashier.create({
            data: { user_id: userId, ...cashierData },
          });
        }
      } else if (existingCashier) {
        await tx.agentCashier.deleteMany({
          where: { cashier_id: existingCashier.id },
        });
        await tx.cashier.delete({ where: { user_id: userId } });
      }

      // Auto-create player wallet when switching to PLAYER (if none exists)
      if (nextRole.name === "PLAYER") {
        const hasPlayerWallet = await tx.wallet.findFirst({
          where: { user_id: userId, wallet_type: "PLAYER" },
        });
        if (!hasPlayerWallet) {
          await tx.wallet.create({
            data: { user_id: userId, wallet_type: "PLAYER", balance: 0 },
          });
        }
      }

      // Replace agent-cashier set when body includes agentCashierIds
      if (nextRole.name === "AGENT" && Array.isArray(agentCashierIds)) {
        await tx.agentCashier.deleteMany({ where: { agent_id: userId } });
        const uniqueIds = [...new Set(agentCashierIds.map(String))];
        if (uniqueIds.length > 0) {
          await tx.agentCashier.deleteMany({
            where: { cashier_id: { in: uniqueIds } },
          });
          await tx.agentCashier.createMany({
            data: uniqueIds.map((id) => ({
              agent_id: userId,
              cashier_id: id,
            })),
            skipDuplicates: true,
          });
        }
      } else if (nextRole.name !== "AGENT") {
        await tx.agentCashier.deleteMany({ where: { agent_id: userId } });
      }

      return tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
          cashier_profile: true,
          agent_assignments: true,
        },
      });
    });

    const updatedUser = mapUser(updated);
    await logAuditEvent({
      req,
      action: "USER_UPDATED",
      module: "USERS",
      entityType: "USER",
      entityId: userId,
      before: mapUser(existingUser),
      after: updatedUser,
    });
    return res.json(updatedUser);
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "User with this email, phone, or username already exists",
      });
    }

    console.error("updateUser error:", error);
    return res.status(500).json({ message: "Failed to update user" });
  }
}
