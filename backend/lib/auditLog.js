import { prisma } from "../Config/db.js";

function buildRequestMeta(req) {
  if (!req) {
    return {
      ip: null,
      userAgent: null,
      method: null,
      path: null,
    };
  }
  return {
    ip:
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
    method: req.method ?? null,
    path: req.originalUrl ?? null,
  };
}

export async function logAuditEvent({
  req,
  action,
  module,
  entityType = null,
  entityId = null,
  before = null,
  after = null,
  meta = {},
  actorUserId,
  actorRole,
}) {
  const userId = actorUserId ?? req?.user?.sub ?? null;
  const role = actorRole ?? req?.user?.role ?? null;
  const resolvedMeta = {
    ...buildRequestMeta(req),
    ...meta,
  };

  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId,
        actor_role: role,
        action,
        module,
        entity_type: entityType,
        entity_id: entityId,
        before,
        after,
        meta: resolvedMeta,
      },
    });
  } catch (error) {
    // Backward compatibility for deployments still running the old AuditLog model.
    // Old shape stores change data inside `data` JSON.
    const unknownField =
      error?.name === "PrismaClientValidationError" &&
      String(error?.message || "").includes("Unknown argument");

    if (unknownField) {
      try {
        await prisma.auditLog.create({
          data: {
            user_id: userId,
            action,
            module,
            data: {
              actorRole: role,
              entityType,
              entityId,
              before,
              after,
              meta: resolvedMeta,
            },
          },
        });
        return;
      } catch (fallbackError) {
        console.error("audit log write fallback failed:", fallbackError);
      }
    }

    console.error("audit log write failed:", error);
  }
}
