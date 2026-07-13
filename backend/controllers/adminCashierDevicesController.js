import { prisma } from "../Config/db.js";
import {
  approvePendingDevice,
  rejectPendingDevice,
  revokeTrustedDevice,
} from "../lib/cashierDeviceAuth.js";
import { logAuditEvent } from "../lib/auditLog.js";

function pendingShape(row) {
  return {
    id: row.id,
    status: row.status,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    cashier: row.cashier
      ? {
          id: row.cashier.id,
          username: row.cashier.username ?? null,
          fullname: row.cashier.fullname,
          phone: row.cashier.phone,
        }
      : null,
  };
}

function trustedShape(row) {
  return {
    id: row.id,
    fingerprintHash: row.fingerprint_hash,
    firstIp: row.first_ip,
    latestIp: row.latest_ip,
    userAgent: row.user_agent,
    approvedByAdmin: row.approved_by_admin,
    isActive: row.is_active,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    cashier: row.cashier
      ? {
          id: row.cashier.id,
          username: row.cashier.username ?? null,
          fullname: row.cashier.fullname,
          phone: row.cashier.phone,
        }
      : null,
  };
}

export async function listPendingDeviceApprovals(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = String(req.query.status || "PENDING").toUpperCase();
    const skip = (page - 1) * limit;

    const where = {
      status: ["PENDING", "APPROVED", "REJECTED"].includes(status)
        ? status
        : "PENDING",
    };

    const [items, total] = await Promise.all([
      prisma.cashierPendingDeviceApproval.findMany({
        where,
        include: {
          cashier: {
            select: { id: true, username: true, fullname: true, phone: true },
          },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.cashierPendingDeviceApproval.count({ where }),
    ]);

    return res.json({
      items: items.map(pendingShape),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listPendingDeviceApprovals error:", error);
    return res.status(500).json({ message: "Failed to list pending devices" });
  }
}

export async function listTrustedDevices(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const activeOnly = String(req.query.activeOnly || "true") === "true";
    const skip = (page - 1) * limit;

    const where = activeOnly ? { is_active: true } : {};

    const [items, total] = await Promise.all([
      prisma.cashierTrustedDevice.findMany({
        where,
        include: {
          cashier: {
            select: { id: true, username: true, fullname: true, phone: true },
          },
        },
        orderBy: { last_seen_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.cashierTrustedDevice.count({ where }),
    ]);

    return res.json({
      items: items.map(trustedShape),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listTrustedDevices error:", error);
    return res.status(500).json({ message: "Failed to list trusted devices" });
  }
}

export async function approveDeviceRequest(req, res) {
  try {
    const result = await approvePendingDevice(req.params.id, req.user.sub);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    await logAuditEvent({
      req,
      action: "CASHIER_DEVICE_APPROVED",
      module: "AUTH",
      entityType: "CashierPendingDeviceApproval",
      entityId: req.params.id,
      meta: { cashierId: result.pending.cashier_id },
    });

    return res.json({ ok: true, pending: pendingShape(result.pending) });
  } catch (error) {
    console.error("approveDeviceRequest error:", error);
    return res.status(500).json({ message: "Failed to approve device" });
  }
}

export async function rejectDeviceRequest(req, res) {
  try {
    const result = await rejectPendingDevice(req.params.id, req.user.sub);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    await logAuditEvent({
      req,
      action: "CASHIER_DEVICE_REJECTED",
      module: "AUTH",
      entityType: "CashierPendingDeviceApproval",
      entityId: req.params.id,
      meta: { cashierId: result.pending.cashier_id },
    });

    return res.json({ ok: true, pending: pendingShape(result.pending) });
  } catch (error) {
    console.error("rejectDeviceRequest error:", error);
    return res.status(500).json({ message: "Failed to reject device" });
  }
}

export async function revokeDevice(req, res) {
  try {
    const result = await revokeTrustedDevice(req.params.id, req.user.sub);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    await logAuditEvent({
      req,
      action: "CASHIER_DEVICE_REVOKED",
      module: "AUTH",
      entityType: "CashierTrustedDevice",
      entityId: req.params.id,
      meta: { cashierId: result.device.cashier_id },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("revokeDevice error:", error);
    return res.status(500).json({ message: "Failed to revoke device" });
  }
}
