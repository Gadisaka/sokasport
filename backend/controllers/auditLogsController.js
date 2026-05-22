import { prisma } from "../Config/db.js";

export async function listAuditLogs(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const action = String(req.query.action || "").trim();
    const module = String(req.query.module || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const where = {};
    if (action) where.action = action;
    if (module) where.module = module;
    if (from || to) {
      where.created_at = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) where.created_at.gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
          // Include full day when date-only input is used from UI.
          if (!to.includes("T")) {
            toDate.setHours(23, 59, 59, 999);
          }
          where.created_at.lte = toDate;
        }
      }
      if (Object.keys(where.created_at).length === 0) delete where.created_at;
    }
    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { module: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
        include: {
          user: {
            select: { id: true, name: true, phone: true },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const normalizedItems = items.map((log) => ({
      ...log,
      actor_role: log.actor_role ?? log.data?.actorRole ?? null,
      entity_type: log.entity_type ?? log.data?.entityType ?? null,
      entity_id: log.entity_id ?? log.data?.entityId ?? null,
      before: log.before ?? log.data?.before ?? null,
      after: log.after ?? log.data?.after ?? null,
      meta: log.meta ?? log.data?.meta ?? null,
    }));

    return res.json({
      items: normalizedItems,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      total,
    });
  } catch (error) {
    console.error("listAuditLogs error:", error);
    return res.status(500).json({ message: "Failed to load audit logs" });
  }
}
