/**
 * Admin updates for preset `Bonus` rows (one per type, seeded). No create.
 *
 * @module controllers/bonusController
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import { sanitizeBonusForPublic } from "../lib/bonusEngine.js";
import {
  ensureBonusPresets,
  PRESET_BONUS_COUNT,
} from "../lib/ensureBonusPresets.js";

/** Avoid Express weak ETag + 304 — admin clients must see fresh bonus rows after seed. */
function setNoStoreHeaders(res) {
  res.set("Cache-Control", "private, no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

export const BONUS_TYPES_ORDER = [
  "WELCOME",
  "FIRST_DEPOSIT",
  "DEPOSIT",
  "ACCUMULATOR",
  "CASHBACK",
  "REFERRAL",
];

const DISALLOWED_BODY_KEYS = new Set(["name", "rules", "type"]);

const ALLOWED_PATCH_KEYS = new Set([
  "status",
  "percentage",
  "min_deposit",
  "welcomeFixedAmount",
  "tiers",
  "minTotalOdds",
  "percentOfStake",
]);

const MAX_ACCUMULATOR_TIERS = 5;

function validateTiers(raw) {
  if (!Array.isArray(raw)) return "tiers must be an array";
  if (raw.length > MAX_ACCUMULATOR_TIERS) {
    return `At most ${MAX_ACCUMULATOR_TIERS} tiers allowed`;
  }
  for (const t of raw) {
    if (!t || typeof t !== "object") return "Each tier must be an object";
    const minL = Number(t.minLegs);
    const bp = Number(t.bonusPercent);
    if (!Number.isInteger(minL) || minL < 1) {
      return "Each tier.minLegs must be an integer >= 1";
    }
    if (!Number.isFinite(bp) || bp < 0 || bp > 100) {
      return "Each tier.bonusPercent must be between 0 and 100";
    }
  }
  return null;
}

/**
 * Build Prisma `data` from whitelisted PATCH body. Rejects unsafe keys.
 *
 * @param {import("@prisma/client").Bonus} existing
 * @param {Record<string, unknown>} body
 * @returns {{ data?: object, error?: string }}
 */
function buildSafeUpdateData(existing, body) {
  for (const key of Object.keys(body)) {
    if (DISALLOWED_BODY_KEYS.has(key)) {
      return { error: `Field "${key}" cannot be changed via API` };
    }
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      return { error: `Unknown or disallowed field "${key}"` };
    }
  }

  const data = {};
  const type = existing.type;

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    data.status = Boolean(body.status);
  }

  if (Object.prototype.hasOwnProperty.call(body, "percentage")) {
    const pct = Number(body.percentage);
    if (!Number.isFinite(pct) || pct < 0) {
      return { error: "percentage must be a non-negative number" };
    }
    data.percentage = pct;
  }

  if (Object.prototype.hasOwnProperty.call(body, "min_deposit")) {
    if (type !== "FIRST_DEPOSIT" && type !== "DEPOSIT") {
      return {
        error: "min_deposit is only allowed for FIRST_DEPOSIT and DEPOSIT",
      };
    }
    const md = body.min_deposit;
    data.min_deposit =
      md === null || md === "" ? null : Number(md);
    if (data.min_deposit != null && (!Number.isFinite(data.min_deposit) || data.min_deposit < 0)) {
      return { error: "min_deposit must be null or a non-negative number" };
    }
  }

  if (type === "WELCOME" && Object.prototype.hasOwnProperty.call(body, "welcomeFixedAmount")) {
    const v = body.welcomeFixedAmount;
    const base =
      existing.rules && typeof existing.rules === "object" && !Array.isArray(existing.rules)
        ? { ...existing.rules }
        : {};
    if (v === null || v === "") {
      delete base.fixedAmount;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return { error: "welcomeFixedAmount must be null or a non-negative number" };
      }
      base.fixedAmount = n;
    }
    data.rules = base;
  }

  if (type === "ACCUMULATOR" && Object.prototype.hasOwnProperty.call(body, "tiers")) {
    const err = validateTiers(body.tiers);
    if (err) return { error: err };
    data.rules = { tiers: body.tiers };
  }

  if (type === "CASHBACK") {
    const hasMin = Object.prototype.hasOwnProperty.call(body, "minTotalOdds");
    const hasPct = Object.prototype.hasOwnProperty.call(body, "percentOfStake");
    if (hasMin || hasPct) {
      const base =
        existing.rules && typeof existing.rules === "object" && !Array.isArray(existing.rules)
          ? { ...existing.rules }
          : {};
      if (hasMin) {
        const m = Number(body.minTotalOdds);
        if (!Number.isFinite(m) || m < 1) {
          return { error: "minTotalOdds must be a number >= 1" };
        }
        base.minTotalOdds = m;
      }
      if (hasPct) {
        const p = Number(body.percentOfStake);
        if (!Number.isFinite(p) || p < 0 || p > 100) {
          return { error: "percentOfStake must be between 0 and 100" };
        }
        base.percentOfStake = p;
      }
      data.rules = base;
    }
  }

  return { data };
}

export async function listBonuses(_req, res) {
  try {
    if ((await prisma.bonus.count()) < PRESET_BONUS_COUNT) {
      await ensureBonusPresets(prisma);
    }
    const items = await prisma.bonus.findMany({});
    const order = new Map(BONUS_TYPES_ORDER.map((t, i) => [t, i]));
    items.sort((a, b) => {
      const ia = order.get(a.type) ?? 99;
      const ib = order.get(b.type) ?? 99;
      return ia - ib;
    });
    setNoStoreHeaders(res);
    return res.json({ items });
  } catch (e) {
    console.error("listBonuses error:", e);
    setNoStoreHeaders(res);
    return res.status(500).json({ message: "Failed to list bonuses" });
  }
}

export async function getBonus(req, res) {
  try {
    const { id } = req.params;
    const row = await prisma.bonus.findUnique({ where: { id } });
    setNoStoreHeaders(res);
    if (!row) return res.status(404).json({ message: "Bonus not found" });
    return res.json(row);
  } catch (e) {
    console.error("getBonus error:", e);
    setNoStoreHeaders(res);
    return res.status(500).json({ message: "Server error" });
  }
}

/** GET — public shape for sportsbook */
export async function listActiveBonusesPublic(_req, res) {
  try {
    const items = await prisma.bonus.findMany({
      where: { status: true },
      orderBy: { type: "asc" },
    });
    return res.json({
      bonuses: items.map(sanitizeBonusForPublic).filter(Boolean),
    });
  } catch (e) {
    console.error("listActiveBonusesPublic error:", e);
    return res.status(500).json({ message: "Failed to load bonuses" });
  }
}

export async function updateBonus(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.bonus.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Bonus not found" });

    const body = req.body ?? {};
    const { data, error } = buildSafeUpdateData(existing, body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No allowed fields to update" });
    }

    const updated = await prisma.bonus.update({
      where: { id },
      data,
    });

    await logAuditEvent({
      req,
      action: "BONUS_UPDATED",
      module: "BONUSES",
      entityType: "BONUS",
      entityId: id,
      before: sanitizeBonusForPublic(existing),
      after: sanitizeBonusForPublic(updated),
    });

    return res.json(updated);
  } catch (e) {
    console.error("updateBonus error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}
