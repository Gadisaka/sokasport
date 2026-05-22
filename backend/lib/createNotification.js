import { prisma } from "../Config/db.js";

const BATCH_SIZE = 100;

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {import("@prisma/client").NotificationKind} params.kind
 * @param {string} params.title
 * @param {string} params.body
 * @param {object} [params.metadata]
 * @param {string} [params.senderId]
 */
export async function createNotification({
  userId,
  kind,
  title,
  body,
  metadata,
  senderId,
}) {
  return prisma.notification.create({
    data: {
      user_id: userId,
      kind,
      title: String(title).trim(),
      body: String(body).trim(),
      metadata: metadata ?? undefined,
      sender_id: senderId ?? undefined,
    },
  });
}

/**
 * Fire-and-forget safe wrapper — logs errors, never throws to caller.
 */
export async function notifyUserSafe(params) {
  try {
    await createNotification(params);
  } catch (err) {
    console.error("notifyUserSafe error:", err);
  }
}

/**
 * @param {string[]} userIds
 * @param {Omit<Parameters<typeof createNotification>[0], "userId">} payload
 */
export async function createNotificationsForUsers(userIds, payload) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { count: 0 };

  let count = 0;
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
    const result = await prisma.notification.createMany({
      data: chunk.map((userId) => ({
        user_id: userId,
        kind: payload.kind,
        title: String(payload.title).trim(),
        body: String(payload.body).trim(),
        metadata: payload.metadata ?? undefined,
        sender_id: payload.senderId ?? undefined,
      })),
    });
    count += result.count;
  }
  return { count };
}

const AUDIENCE_ROLE = {
  all_cashiers: "CASHIER",
  all_players: "PLAYER",
  all_admins: "ADMIN",
};

/**
 * @param {"all_cashiers"|"all_players"|"specific_player"|"specific_cashier"} audience
 * @param {string} [specificUserId]
 */
export async function resolveRecipientUserIds(audience, specificUserId) {
  if (audience === "specific_player" || audience === "specific_cashier") {
    const expectedRole = audience === "specific_player" ? "PLAYER" : "CASHIER";
    const user = await prisma.user.findUnique({
      where: { id: String(specificUserId || "").trim() },
      include: { role: true },
    });
    if (!user || !user.status) return [];
    if (user.role?.name !== expectedRole) return [];
    return [user.id];
  }

  const roleName = AUDIENCE_ROLE[audience];
  if (!roleName) return [];

  if (audience === "all_admins") {
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

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return [];

  const users = await prisma.user.findMany({
    where: { role_id: role.id, status: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
