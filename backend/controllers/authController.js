/**
 * Auth controller — login and current-user profile.
 *
 * Login uses phone + password (not email). JWT payload includes `sub` (user id),
 * `phone`, and `role` (RoleName enum string) for middleware authorization.
 *
 * @module controllers/authController
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { handleCashierDeviceLogin } from "../lib/cashierDeviceAuth.js";

function publicUserShape(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role.name,
    status: user.status,
    createdAt: user.created_at,
  };
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Add it to your .env file.");
}

/**
 * POST /api/auth/login
 * Body: { phone, password, fingerprint? }
 * Returns { accessToken, user } on success; 401 for bad credentials or disabled user.
 */
export async function login(req, res) {
  const { phone, password, fingerprint } = req.body ?? {};
  const normalizedPhone = phone ? String(phone).trim() : null;

  if (!phone || !password) {
    await logAuditEvent({
      req,
      action: "AUTH_LOGIN_FAILED",
      module: "AUTH",
      entityType: "USER",
      meta: { reason: "MISSING_CREDENTIALS", phone: normalizedPhone },
    });
    return res
      .status(400)
      .json({ message: "Phone and password are required" });
  }

  const user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
    include: { role: true },
  });

  // Same message for missing user, wrong password, or inactive account (no user enumeration)
  if (!user || !user.status) {
    await logAuditEvent({
      req,
      action: "AUTH_LOGIN_FAILED",
      module: "AUTH",
      entityType: "USER",
      entityId: user?.id ?? null,
      actorUserId: user?.id ?? null,
      actorRole: user?.role?.name ?? null,
      meta: { reason: user ? "INACTIVE_USER" : "USER_NOT_FOUND", phone: normalizedPhone },
    });
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    await logAuditEvent({
      req,
      action: "AUTH_LOGIN_FAILED",
      module: "AUTH",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role.name,
      meta: { reason: "WRONG_PASSWORD", phone: normalizedPhone },
    });
    return res.status(401).json({ message: "Invalid credentials" });
  }

  if (user.role.name === "CASHIER") {
    const deviceResult = await handleCashierDeviceLogin({
      req,
      res,
      user,
      fingerprint,
    });
    if (!deviceResult.ok) {
      return res.status(deviceResult.status).json(deviceResult.body);
    }
  }

  const tokenPayload = {
    sub: user.id,
    phone: user.phone,
    role: user.role.name,
  };

  const accessToken = jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  await logAuditEvent({
    req,
    action: "AUTH_LOGIN_SUCCESS",
    module: "AUTH",
    entityType: "USER",
    entityId: user.id,
    actorUserId: user.id,
    actorRole: user.role.name,
    before: null,
    after: {
      id: user.id,
      role: user.role.name,
      status: user.status,
    },
  });

  return res.json({
    accessToken,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role.name,
    },
  });
}

/**
 * POST /api/auth/verify-password
 * Requires `authenticateToken`. Body: { password }
 * Use for step-up checks (e.g. cashier dashboard unlock) without issuing a new JWT.
 */
export async function verifyPassword(req, res) {
  try {
    const { password } = req.body ?? {};
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { role: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      await logAuditEvent({
        req,
        action: "AUTH_VERIFY_PASSWORD_FAILED",
        module: "AUTH",
        entityType: "USER",
        entityId: user.id,
        actorUserId: user.id,
        actorRole: user.role.name,
        meta: { reason: "WRONG_PASSWORD" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("verifyPassword error:", error);
    return res.status(500).json({ message: "Failed to verify password" });
  }
}

/**
 * GET /api/auth/me
 * Requires `authenticateToken`. Uses JWT `sub` as user id.
 */
export async function getMe(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    include: { role: true },
  });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json(publicUserShape(user));
}

/**
 * PATCH /api/auth/profile
 * Requires `authenticateToken`. Body: { name?, phone? } — at least one field.
 *
 * Role rules:
 * - PLAYER: name and phone; phone change syncs synthetic email (`${phone}@player.local`). New JWT when phone changes.
 * - ADMIN / SUPER_ADMIN: name and phone; phone change does not alter email. New JWT when phone changes.
 * - Other roles: cannot update name or phone (403).
 */
export async function patchProfile(req, res) {
  try {
    const body = req.body ?? {};
    const nameProvided = Object.prototype.hasOwnProperty.call(body, "name");
    const phoneProvided = Object.prototype.hasOwnProperty.call(body, "phone");

    if (!nameProvided && !phoneProvided) {
      return res.status(400).json({ message: "Provide name and/or phone to update" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { role: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const roleName = user.role.name;
    const canEditContact =
      roleName === "PLAYER" ||
      roleName === "ADMIN" ||
      roleName === "SUPER_ADMIN";

    if ((nameProvided || phoneProvided) && !canEditContact) {
      return res.status(403).json({
        message: "You cannot update your profile contact details",
      });
    }

    const data = {};

    if (nameProvided) {
      const trimmed = String(body.name ?? "").trim();
      if (!trimmed) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }
      if (trimmed !== user.name) {
        data.name = trimmed;
      }
    }

    if (phoneProvided) {
      const trimmedPhone = String(body.phone ?? "").trim();
      if (!trimmedPhone) {
        return res.status(400).json({ message: "Phone cannot be empty" });
      }
      if (trimmedPhone !== user.phone) {
        data.phone = trimmedPhone;
        if (roleName === "PLAYER") {
          data.email = `${trimmedPhone}@player.local`;
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return res.json({
        user: publicUserShape(user),
        accessToken: null,
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      include: { role: true },
    });

    let accessToken = null;
    if (data.phone !== undefined) {
      accessToken = jwt.sign(
        { sub: updated.id, phone: updated.phone, role: updated.role.name },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
      );
    }

    await logAuditEvent({
      req,
      action: "AUTH_PROFILE_UPDATED",
      module: "AUTH",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role.name,
      meta: {
        fields: Object.keys(data),
        phoneChanged: Boolean(data.phone),
      },
    });

    return res.json({
      user: publicUserShape(updated),
      accessToken,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res
        .status(409)
        .json({ message: "That phone number is already in use" });
    }
    console.error("patchProfile error:", error);
    return res.status(500).json({ message: "Failed to update profile" });
  }
}

/**
 * PATCH /api/auth/change-password
 * Requires `authenticateToken`. Verifies old password, sets new one.
 * Body: { oldPassword, newPassword, confirmPassword }
 */
export async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body ?? {};

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { role: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const passwordMatches = await bcrypt.compare(oldPassword, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.sub },
      data: { password: hashedPassword },
    });

    await logAuditEvent({
      req,
      action: "AUTH_PASSWORD_CHANGED",
      module: "AUTH",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role.name,
    });

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ message: "Failed to change password" });
  }
}
