import { prisma } from "../Config/db.js";
import {
  createNotificationsForUsers,
  resolveRecipientUserIds,
} from "../lib/createNotification.js";
import { adminMessageNotification } from "../lib/notificationMessages.js";
import crypto from "crypto";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePagination(query) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );
  return { page, limit, skip: (page - 1) * limit };
}

function serializeNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? null,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listNotifications(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { page, limit, skip } = parsePagination(req.query);
    const unreadOnly =
      String(req.query.unreadOnly ?? "").toLowerCase() === "true" ||
      req.query.unreadOnly === "1";

    const where = {
      user_id: userId,
      ...(unreadOnly ? { read_at: null } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return res.json({
      items: items.map(serializeNotification),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("listNotifications error:", error);
    return res.status(500).json({ message: "Failed to load notifications" });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const count = await prisma.notification.count({
      where: { user_id: userId, read_at: null },
    });

    return res.json({ count });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    return res.status(500).json({ message: "Failed to load unread count" });
  }
}

export async function markNotificationRead(req, res) {
  try {
    const userId = req.user?.sub;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const row = await prisma.notification.findFirst({
      where: { id, user_id: userId },
    });
    if (!row) {
      return res.status(404).json({ message: "Notification not found" });
    }

    if (!row.read_at) {
      await prisma.notification.update({
        where: { id },
        data: { read_at: new Date() },
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("markNotificationRead error:", error);
    return res.status(500).json({ message: "Failed to mark notification read" });
  }
}

export async function markAllNotificationsRead(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await prisma.notification.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    return res.status(500).json({ message: "Failed to mark all read" });
  }
}

const VALID_AUDIENCES = new Set([
  "all_cashiers",
  "all_players",
  "specific_player",
  "specific_cashier",
]);

export async function sendAdminNotification(req, res) {
  try {
    const { audience, userId, title, body } = req.body ?? {};

    if (!VALID_AUDIENCES.has(audience)) {
      return res.status(400).json({
        message:
          'audience must be one of: "all_cashiers", "all_players", "specific_player", "specific_cashier"',
      });
    }

    const trimmedTitle = String(title ?? "").trim();
    const trimmedBody = String(body ?? "").trim();
    if (!trimmedTitle) {
      return res.status(400).json({ message: "title is required" });
    }
    if (!trimmedBody) {
      return res.status(400).json({ message: "body is required" });
    }

    if (
      (audience === "specific_player" || audience === "specific_cashier") &&
      !String(userId ?? "").trim()
    ) {
      return res.status(400).json({ message: "userId is required for specific audience" });
    }

    const recipientIds = await resolveRecipientUserIds(audience, userId);
    if (recipientIds.length === 0) {
      return res.status(400).json({ message: "No recipients found for this audience" });
    }

    const batchId = crypto.randomUUID();
    const payload = adminMessageNotification({
      title: trimmedTitle,
      body: trimmedBody,
      batchId,
    });

    const { count } = await createNotificationsForUsers(recipientIds, {
      ...payload,
      senderId: req.user.sub,
    });

    return res.status(201).json({
      ok: true,
      recipientCount: count,
      batchId,
    });
  } catch (error) {
    console.error("sendAdminNotification error:", error);
    return res.status(500).json({ message: "Failed to send notification" });
  }
}
