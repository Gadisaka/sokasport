import crypto from "crypto";
import { prisma } from "../Config/db.js";
import {
  createNotificationsForUsers,
  notifyUserSafe,
} from "./createNotification.js";
import {
  deviceApprovalPendingNotification,
  deviceApprovedNotification,
  deviceRejectedNotification,
} from "./notificationMessages.js";

const DEVICE_COOKIE_NAME = "device_token";
const DEVICE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function hashIdentifier(raw) {
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

export function generateDeviceToken() {
  return crypto.randomBytes(48).toString("hex");
}

export function getCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function extractClientMeta(req) {
  return {
    ip:
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null,
    userAgent: req.headers["user-agent"] || null,
  };
}

export function setDeviceTokenCookie(res, rawToken) {
  const parts = [
    `${DEVICE_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(DEVICE_COOKIE_MAX_AGE_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

/**
 * Pure decision helper — used by validateCashierDevice and tests.
 */
export function evaluateDeviceTrust({
  trustedDevice,
  fingerprintHash,
  deviceTokenHash,
}) {
  if (!trustedDevice || !trustedDevice.is_active) {
    return { allowed: false, reason: "NO_TRUSTED_DEVICE" };
  }
  if (!fingerprintHash) {
    return { allowed: false, reason: "MISSING_FINGERPRINT" };
  }

  const tokenMatches =
    Boolean(deviceTokenHash) &&
    trustedDevice.device_token_hash === deviceTokenHash;
  const fingerprintMatches =
    trustedDevice.fingerprint_hash === fingerprintHash;

  if (tokenMatches && fingerprintMatches) {
    return { allowed: true, reason: "DEVICE_MATCH" };
  }

  if (tokenMatches && !fingerprintMatches) {
    return {
      allowed: true,
      reason: "TOKEN_MATCH_FINGERPRINT_DRIFT",
      updateFingerprint: true,
    };
  }

  return { allowed: false, reason: "DEVICE_MISMATCH" };
}

export async function logCashierLoginAttempt({
  cashierId,
  ipAddress,
  fingerprintHash,
  userAgent,
  success,
  reason,
}) {
  try {
    await prisma.cashierLoginAttempt.create({
      data: {
        cashier_id: cashierId ?? null,
        ip_address: ipAddress || "unknown",
        fingerprint_hash: fingerprintHash ?? null,
        user_agent: userAgent ?? null,
        success,
        reason: reason ?? null,
      },
    });
  } catch (err) {
    console.error("logCashierLoginAttempt error:", err);
  }
}

async function resolveAdminUserIds() {
  const roles = await prisma.role.findMany({
    where: { name: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  if (roles.length === 0) return [];
  const users = await prisma.user.findMany({
    where: {
      role_id: { in: roles.map((r) => r.id) },
      status: true,
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function notifyAdminsDevicePending({
  cashier,
  pendingId,
  ipAddress,
  userAgent,
}) {
  const adminIds = await resolveAdminUserIds();
  if (adminIds.length === 0) return;

  const payload = deviceApprovalPendingNotification({
    cashierName: cashier.name,
    cashierPhone: cashier.phone,
    pendingId,
    ipAddress,
    userAgent,
  });

  await createNotificationsForUsers(adminIds, payload);
}

export async function validateCashierDevice({
  cashierId,
  fingerprintHash,
  deviceTokenRaw,
}) {
  const deviceTokenHash = hashIdentifier(deviceTokenRaw);
  const trustedDevice = await prisma.cashierTrustedDevice.findFirst({
    where: { cashier_id: cashierId, is_active: true },
  });

  const evaluation = evaluateDeviceTrust({
    trustedDevice,
    fingerprintHash,
    deviceTokenHash,
  });

  return {
    ...evaluation,
    trustedDevice,
    deviceTokenHash,
  };
}

export async function registerTrustedDevice({
  res,
  cashierId,
  fingerprintHash,
  meta,
  approvedByAdmin = true,
}) {
  const rawToken = generateDeviceToken();
  const tokenHash = hashIdentifier(rawToken);

  await prisma.cashierTrustedDevice.updateMany({
    where: { cashier_id: cashierId, is_active: true },
    data: { is_active: false, revoked_at: new Date() },
  });

  const device = await prisma.cashierTrustedDevice.create({
    data: {
      cashier_id: cashierId,
      fingerprint_hash: fingerprintHash,
      device_token_hash: tokenHash,
      first_ip: meta.ip,
      latest_ip: meta.ip,
      user_agent: meta.userAgent,
      approved_by_admin: approvedByAdmin,
      is_active: true,
    },
  });

  setDeviceTokenCookie(res, rawToken);

  return { device, rawToken, tokenHash };
}

export async function touchTrustedDevice(deviceId, meta, fingerprintHash) {
  const data = {
    latest_ip: meta.ip,
    last_seen_at: new Date(),
  };
  if (fingerprintHash) {
    data.fingerprint_hash = fingerprintHash;
  }
  return prisma.cashierTrustedDevice.update({
    where: { id: deviceId },
    data,
  });
}

export async function createPendingApproval({
  res,
  cashier,
  fingerprintHash,
  meta,
}) {
  const rawToken = generateDeviceToken();
  const tokenHash = hashIdentifier(rawToken);

  const existingPending = await prisma.cashierPendingDeviceApproval.findFirst({
    where: {
      cashier_id: cashier.id,
      status: "PENDING",
      fingerprint_hash: fingerprintHash,
    },
  });

  let pending;
  if (existingPending) {
    pending = await prisma.cashierPendingDeviceApproval.update({
      where: { id: existingPending.id },
      data: {
        device_token_hash: tokenHash,
        ip_address: meta.ip || "unknown",
        user_agent: meta.userAgent,
      },
    });
  } else {
    pending = await prisma.cashierPendingDeviceApproval.create({
      data: {
        cashier_id: cashier.id,
        fingerprint_hash: fingerprintHash,
        device_token_hash: tokenHash,
        ip_address: meta.ip || "unknown",
        user_agent: meta.userAgent,
        status: "PENDING",
      },
    });
  }

  setDeviceTokenCookie(res, rawToken);

  await notifyAdminsDevicePending({
    cashier,
    pendingId: pending.id,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  return pending;
}

export async function handleCashierDeviceLogin({
  req,
  res,
  user,
  fingerprint,
}) {
  const meta = extractClientMeta(req);
  const fingerprintHash = hashIdentifier(fingerprint);
  const deviceTokenRaw = getCookie(req, DEVICE_COOKIE_NAME);

  if (!fingerprintHash) {
    await logCashierLoginAttempt({
      cashierId: user.id,
      ipAddress: meta.ip,
      fingerprintHash: null,
      userAgent: meta.userAgent,
      success: false,
      reason: "MISSING_FINGERPRINT",
    });
    return {
      ok: false,
      status: 400,
      body: {
        code: "MISSING_FINGERPRINT",
        message: "Device fingerprint is required for cashier login.",
      },
    };
  }

  const validation = await validateCashierDevice({
    cashierId: user.id,
    fingerprintHash,
    deviceTokenRaw,
  });

  if (!validation.trustedDevice) {
    await registerTrustedDevice({
      res,
      cashierId: user.id,
      fingerprintHash,
      meta,
      approvedByAdmin: true,
    });
    await logCashierLoginAttempt({
      cashierId: user.id,
      ipAddress: meta.ip,
      fingerprintHash,
      userAgent: meta.userAgent,
      success: true,
      reason: "FIRST_DEVICE_REGISTERED",
    });
    return { ok: true };
  }

  if (validation.allowed) {
    await touchTrustedDevice(
      validation.trustedDevice.id,
      meta,
      validation.updateFingerprint ? fingerprintHash : null,
    );
    await logCashierLoginAttempt({
      cashierId: user.id,
      ipAddress: meta.ip,
      fingerprintHash,
      userAgent: meta.userAgent,
      success: true,
      reason: validation.reason,
    });
    return { ok: true };
  }

  const pending = await createPendingApproval({
    res,
    cashier: user,
    fingerprintHash,
    meta,
  });

  await logCashierLoginAttempt({
    cashierId: user.id,
    ipAddress: meta.ip,
    fingerprintHash,
    userAgent: meta.userAgent,
    success: false,
    reason: validation.reason,
  });

  return {
    ok: false,
    status: 403,
    body: {
      code: "DEVICE_APPROVAL_REQUIRED",
      message: "Login from a new device requires admin approval.",
      pendingId: pending.id,
      cashierName: user.name,
      cashierPhone: user.phone,
    },
  };
}

export async function approvePendingDevice(pendingId, adminUserId) {
  const pending = await prisma.cashierPendingDeviceApproval.findUnique({
    where: { id: pendingId },
    include: {
      cashier: { select: { id: true, name: true, phone: true } },
    },
  });

  if (!pending) {
    return { ok: false, status: 404, message: "Pending approval not found" };
  }
  if (pending.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      message: `Request already ${pending.status.toLowerCase()}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.cashierTrustedDevice.updateMany({
      where: { cashier_id: pending.cashier_id, is_active: true },
      data: { is_active: false, revoked_at: new Date() },
    });

    await tx.cashierTrustedDevice.create({
      data: {
        cashier_id: pending.cashier_id,
        fingerprint_hash: pending.fingerprint_hash,
        device_token_hash: pending.device_token_hash,
        first_ip: pending.ip_address,
        latest_ip: pending.ip_address,
        user_agent: pending.user_agent,
        approved_by_admin: true,
        is_active: true,
      },
    });

    await tx.cashierPendingDeviceApproval.update({
      where: { id: pending.id },
      data: {
        status: "APPROVED",
        resolved_at: new Date(),
        resolved_by_id: adminUserId,
      },
    });
  });

  const payload = deviceApprovedNotification({
    cashierName: pending.cashier.name,
  });
  await notifyUserSafe({
    userId: pending.cashier_id,
    ...payload,
  });

  return { ok: true, pending };
}

export async function rejectPendingDevice(pendingId, adminUserId) {
  const pending = await prisma.cashierPendingDeviceApproval.findUnique({
    where: { id: pendingId },
    include: {
      cashier: { select: { id: true, name: true, phone: true } },
    },
  });

  if (!pending) {
    return { ok: false, status: 404, message: "Pending approval not found" };
  }
  if (pending.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      message: `Request already ${pending.status.toLowerCase()}`,
    };
  }

  await prisma.cashierPendingDeviceApproval.update({
    where: { id: pending.id },
    data: {
      status: "REJECTED",
      resolved_at: new Date(),
      resolved_by_id: adminUserId,
    },
  });

  const payload = deviceRejectedNotification({
    cashierName: pending.cashier.name,
  });
  await notifyUserSafe({
    userId: pending.cashier_id,
    ...payload,
  });

  return { ok: true, pending };
}

export async function revokeTrustedDevice(deviceId, adminUserId) {
  const device = await prisma.cashierTrustedDevice.findUnique({
    where: { id: deviceId },
  });
  if (!device) {
    return { ok: false, status: 404, message: "Trusted device not found" };
  }
  if (!device.is_active) {
    return { ok: false, status: 409, message: "Device is already revoked" };
  }

  await prisma.cashierTrustedDevice.update({
    where: { id: deviceId },
    data: { is_active: false, revoked_at: new Date() },
  });

  return { ok: true, device, adminUserId };
}
