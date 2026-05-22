/**
 * Admin platform settings (key-value in `settings` table).
 *
 * Covers ticket-cancel-window and all betting / financial limit settings
 * from game-management.md.
 *
 * @module controllers/settingsController
 */
import { prisma } from "../Config/db.js";
import { logAuditEvent } from "../lib/auditLog.js";
import {
  DEFAULT_TICKET_CANCEL_WINDOW_MINUTES,
  MAX_TICKET_CANCEL_WINDOW_MINUTES,
  TICKET_CANCEL_WINDOW_SETTING_KEY,
  resolveCancelWindowMinutes,
} from "../lib/ticketCancelWindow.js";
import {
  CASHOUT_MARGIN_SETTING_KEY,
  DEFAULT_CASHOUT_MARGIN,
  MAX_CASHOUT_MARGIN,
  MIN_CASHOUT_MARGIN,
  resolveCashoutMargin,
} from "../lib/cashoutMargin.js";
import {
  HOME_HERO_BANNERS_SETTING_KEY,
  parseHomeHeroBannersValue,
  validateHeroBannerUrls,
} from "../lib/homeHeroBanners.js";
import {
  PLAYER_INFO_PAGES_SETTING_KEY,
  coercePlayerInfoPagesPayload,
  mergePlayerInfoPagesWithDefaults,
  parsePlayerInfoPagesValue,
  validateMergedPlayerInfoPages,
} from "../lib/playerInfoPages.js";
import {
  PLAYER_SITE_BRANDING_SETTING_KEY,
  parsePlayerSiteBrandingValue,
  validatePlayerSiteBrandingPayload,
} from "../lib/playerSiteBranding.js";
import { BETTING_LIMIT_KEYS } from "../lib/bettingLimits.js";
import {
  ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
  parseReceiversSetting,
  validateReceiversRequestBody,
} from "../lib/onlineDepositReceiversConfig.js";
import {
  DEFAULT_WINNINGS_TAX_ENABLED,
  DEFAULT_WINNINGS_TAX_RATE,
  MAX_WINNINGS_TAX_RATE,
  MIN_WINNINGS_TAX_RATE,
  WINNINGS_TAX_ENABLED_SETTING_KEY,
  WINNINGS_TAX_RATE_SETTING_KEY,
  resolveWinningsTax,
} from "../lib/winningsTax.js";

// ─── Ticket cancel window ────────────────────────────────────────────────────

export async function getTicketCancelWindow(_req, res) {
  try {
    const minutes = await resolveCancelWindowMinutes(prisma);
    const row = await prisma.setting.findUnique({
      where: { key: TICKET_CANCEL_WINDOW_SETTING_KEY },
    });

    return res.json({
      minutes,
      configuredInDatabase: Boolean(row),
      defaultMinutes: DEFAULT_TICKET_CANCEL_WINDOW_MINUTES,
      maxMinutes: MAX_TICKET_CANCEL_WINDOW_MINUTES,
    });
  } catch (error) {
    console.error("getTicketCancelWindow error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load ticket cancel window setting" });
  }
}

export async function putTicketCancelWindow(req, res) {
  try {
    const { minutes } = req.body ?? {};
    const parsed = Number.parseInt(minutes, 10);

    if (
      !Number.isFinite(parsed) ||
      parsed < 1 ||
      parsed > MAX_TICKET_CANCEL_WINDOW_MINUTES
    ) {
      return res.status(400).json({
        message: `minutes must be between 1 and ${MAX_TICKET_CANCEL_WINDOW_MINUTES}`,
      });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: TICKET_CANCEL_WINDOW_SETTING_KEY },
    });
    const updated = await prisma.setting.upsert({
      where: { key: TICKET_CANCEL_WINDOW_SETTING_KEY },
      create: {
        key: TICKET_CANCEL_WINDOW_SETTING_KEY,
        value: String(parsed),
      },
      update: { value: String(parsed) },
    });

    await logAuditEvent({
      req,
      action: "SETTINGS_TICKET_CANCEL_WINDOW_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: TICKET_CANCEL_WINDOW_SETTING_KEY,
      before: { minutes: beforeRow ? Number(beforeRow.value) : null },
      after: { minutes: Number(updated.value) },
    });

    return res.json({
      message: "Ticket cancellation window updated",
      minutes: Number.parseInt(updated.value, 10),
    });
  } catch (error) {
    console.error("putTicketCancelWindow error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update ticket cancel window" });
  }
}

// ─── Cash out margin ─────────────────────────────────────────────────────────

export async function getCashoutMargin(_req, res) {
  try {
    const margin = await resolveCashoutMargin(prisma);
    const row = await prisma.setting.findUnique({
      where: { key: CASHOUT_MARGIN_SETTING_KEY },
    });

    return res.json({
      margin,
      configuredInDatabase: Boolean(row),
      defaultMargin: DEFAULT_CASHOUT_MARGIN,
      minMargin: MIN_CASHOUT_MARGIN,
      maxMargin: MAX_CASHOUT_MARGIN,
    });
  } catch (error) {
    console.error("getCashoutMargin error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load cashout margin setting" });
  }
}

export async function putCashoutMargin(req, res) {
  try {
    const { margin } = req.body ?? {};
    const parsed = Number.parseFloat(margin);

    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_CASHOUT_MARGIN ||
      parsed > MAX_CASHOUT_MARGIN
    ) {
      return res.status(400).json({
        message: `margin must be between ${MIN_CASHOUT_MARGIN} and ${MAX_CASHOUT_MARGIN}`,
      });
    }

    const normalized = Math.round(parsed * 1000) / 1000;
    const beforeRow = await prisma.setting.findUnique({
      where: { key: CASHOUT_MARGIN_SETTING_KEY },
    });

    const updated = await prisma.setting.upsert({
      where: { key: CASHOUT_MARGIN_SETTING_KEY },
      create: {
        key: CASHOUT_MARGIN_SETTING_KEY,
        value: String(normalized),
      },
      update: { value: String(normalized) },
    });

    await logAuditEvent({
      req,
      action: "SETTINGS_CASHOUT_MARGIN_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: CASHOUT_MARGIN_SETTING_KEY,
      before: { margin: beforeRow ? Number(beforeRow.value) : null },
      after: { margin: Number(updated.value) },
    });

    return res.json({
      message: "Cashout margin updated",
      margin: Number(updated.value),
    });
  } catch (error) {
    console.error("putCashoutMargin error:", error);
    return res.status(500).json({ message: "Failed to update cashout margin" });
  }
}

// ─── Winnings tax (player slips + settlement snapshot) ───────────────────────

export async function getWinningsTax(_req, res) {
  try {
    const { enabled, rate, configuredInDatabase } =
      await resolveWinningsTax(prisma);

    return res.json({
      enabled,
      rate,
      configuredInDatabase,
      defaultEnabled: DEFAULT_WINNINGS_TAX_ENABLED,
      defaultRate: DEFAULT_WINNINGS_TAX_RATE,
      minRate: MIN_WINNINGS_TAX_RATE,
      maxRate: MAX_WINNINGS_TAX_RATE,
    });
  } catch (error) {
    console.error("getWinningsTax error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load winnings tax settings" });
  }
}

export async function putWinningsTax(req, res) {
  try {
    const { enabled, rate } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be a boolean" });
    }

    const parsedRate = Number.parseFloat(rate);
    if (
      !Number.isFinite(parsedRate) ||
      parsedRate < MIN_WINNINGS_TAX_RATE ||
      parsedRate > MAX_WINNINGS_TAX_RATE
    ) {
      return res.status(400).json({
        message: `rate must be between ${MIN_WINNINGS_TAX_RATE} and ${MAX_WINNINGS_TAX_RATE} (decimal, e.g. 0.15 for 15%)`,
      });
    }

    const normalizedRate = Math.round(parsedRate * 100_000) / 100_000;

    const beforeEnabled = await prisma.setting.findUnique({
      where: { key: WINNINGS_TAX_ENABLED_SETTING_KEY },
    });
    const beforeRate = await prisma.setting.findUnique({
      where: { key: WINNINGS_TAX_RATE_SETTING_KEY },
    });

    await prisma.setting.upsert({
      where: { key: WINNINGS_TAX_ENABLED_SETTING_KEY },
      create: {
        key: WINNINGS_TAX_ENABLED_SETTING_KEY,
        value: enabled ? "true" : "false",
      },
      update: { value: enabled ? "true" : "false" },
    });

    await prisma.setting.upsert({
      where: { key: WINNINGS_TAX_RATE_SETTING_KEY },
      create: {
        key: WINNINGS_TAX_RATE_SETTING_KEY,
        value: String(normalizedRate),
      },
      update: { value: String(normalizedRate) },
    });

    await logAuditEvent({
      req,
      action: "SETTINGS_WINNINGS_TAX_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: "WINNINGS_TAX",
      before: {
        enabled:
          beforeEnabled?.value === "true" || beforeEnabled?.value === "1",
        rate: beforeRate ? Number(beforeRate.value) : null,
      },
      after: { enabled, rate: normalizedRate },
    });

    return res.json({
      message: "Winnings tax updated",
      enabled,
      rate: normalizedRate,
    });
  } catch (error) {
    console.error("putWinningsTax error:", error);
    return res.status(500).json({ message: "Failed to update winnings tax" });
  }
}

// ─── Betting limits (bulk get / individual put) ──────────────────────────────

/**
 * GET /api/admin/settings/betting-limits
 * Returns all seven limit settings (null when not yet configured).
 */
export async function getBettingLimits(_req, res) {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: BETTING_LIMIT_KEYS } },
    });

    const map = {};
    for (const key of BETTING_LIMIT_KEYS) {
      const row = rows.find((r) => r.key === key);
      map[key] = row ? Number(row.value) : null;
    }

    return res.json(map);
  } catch (error) {
    console.error("getBettingLimits error:", error);
    return res.status(500).json({ message: "Failed to load betting limits" });
  }
}

/**
 * PUT /api/admin/settings/betting-limits
 * Body: partial object of { MIN_BET_AMOUNT?: number, MAX_BET_AMOUNT?: number, ... }
 * Only provided keys are upserted.
 */
export async function putBettingLimits(req, res) {
  try {
    const body = req.body ?? {};
    const updates = [];

    for (const key of BETTING_LIMIT_KEYS) {
      if (body[key] !== undefined) {
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value < 0) {
          return res
            .status(400)
            .json({ message: `${key} must be a non-negative number` });
        }
        updates.push({ key, value: String(value) });
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        message: `Provide at least one of: ${BETTING_LIMIT_KEYS.join(", ")}`,
      });
    }

    const beforeRows = await prisma.setting.findMany({
      where: { key: { in: updates.map((u) => u.key) } },
    });
    for (const { key, value } of updates) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }

    // Return full state after update
    const rows = await prisma.setting.findMany({
      where: { key: { in: BETTING_LIMIT_KEYS } },
    });
    const map = {};
    for (const k of BETTING_LIMIT_KEYS) {
      const row = rows.find((r) => r.key === k);
      map[k] = row ? Number(row.value) : null;
    }

    await logAuditEvent({
      req,
      action: "SETTINGS_BETTING_LIMITS_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: "BETTING_LIMITS",
      before: Object.fromEntries(
        beforeRows.map((r) => [r.key, Number(r.value)]),
      ),
      after: map,
    });
    return res.json({ message: "Betting limits updated", limits: map });
  } catch (error) {
    console.error("putBettingLimits error:", error);
    return res.status(500).json({ message: "Failed to update betting limits" });
  }
}

// ─── Online deposit receivers (player-facing display + verify match) ─────────

export async function getOnlineDepositReceivers(_req, res) {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const receivers = parseReceiversSetting(row?.value);
    return res.json({
      receivers,
      configuredInDatabase: Boolean(row),
    });
  } catch (error) {
    console.error("getOnlineDepositReceivers error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load online deposit receivers" });
  }
}

export async function putOnlineDepositReceivers(req, res) {
  try {
    const validated = validateReceiversRequestBody(req.body ?? {});
    if (!validated.ok) {
      return res.status(400).json({ message: validated.message });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const beforeParsed = parseReceiversSetting(beforeRow?.value);
    const jsonValue = JSON.stringify(validated.value);

    await prisma.setting.upsert({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
      create: {
        key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
        value: jsonValue,
      },
      update: { value: jsonValue },
    });

    await logAuditEvent({
      req,
      action: "SETTINGS_ONLINE_DEPOSIT_RECEIVERS_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
      before: beforeParsed,
      after: validated.value,
    });

    return res.json({
      message: "Online deposit receivers updated",
      receivers: validated.value,
    });
  } catch (error) {
    console.error("putOnlineDepositReceivers error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update online deposit receivers" });
  }
}

// ─── Home hero banners (CMS) ─────────────────────────────────────────────────

export async function getHomeHeroBanners(_req, res) {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: HOME_HERO_BANNERS_SETTING_KEY },
    });
    const urls = row ? parseHomeHeroBannersValue(row.value) : [];
    return res.json({
      urls,
      configuredInDatabase: Boolean(row),
    });
  } catch (error) {
    console.error("getHomeHeroBanners error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load home hero banners" });
  }
}

export async function putHomeHeroBanners(req, res) {
  try {
    const { urls } = req.body ?? {};
    const validation = validateHeroBannerUrls(urls ?? []);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: HOME_HERO_BANNERS_SETTING_KEY },
    });
    const beforeUrls = beforeRow
      ? parseHomeHeroBannersValue(beforeRow.value)
      : [];
    const jsonValue = JSON.stringify(validation.urls);

    await prisma.setting.upsert({
      where: { key: HOME_HERO_BANNERS_SETTING_KEY },
      create: {
        key: HOME_HERO_BANNERS_SETTING_KEY,
        value: jsonValue,
      },
      update: { value: jsonValue },
    });

    await logAuditEvent({
      req,
      action: "CMS_HOME_HERO_BANNERS_UPDATED",
      module: "CMS",
      entityType: "SETTING",
      entityId: HOME_HERO_BANNERS_SETTING_KEY,
      before: { urls: beforeUrls },
      after: { urls: validation.urls },
    });

    return res.json({
      message: "Home hero banners updated",
      urls: validation.urls,
      configuredInDatabase: true,
    });
  } catch (error) {
    console.error("putHomeHeroBanners error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update home hero banners" });
  }
}

// ─── Player info pages (CMS) ────────────────────────────────────────────────

export async function getPlayerInfoPages(_req, res) {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: PLAYER_INFO_PAGES_SETTING_KEY },
    });
    const parsed = row ? parsePlayerInfoPagesValue(row.value) : {};
    const pages = mergePlayerInfoPagesWithDefaults(parsed);
    return res.json({
      pages,
      configuredInDatabase: Boolean(row),
    });
  } catch (error) {
    console.error("getPlayerInfoPages error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load player info pages" });
  }
}

export async function putPlayerInfoPages(req, res) {
  try {
    const { pages: bodyPages } = req.body ?? {};
    const coerced = coercePlayerInfoPagesPayload(bodyPages);
    const validation = validateMergedPlayerInfoPages(coerced);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: PLAYER_INFO_PAGES_SETTING_KEY },
    });
    const beforeParsed = beforeRow
      ? parsePlayerInfoPagesValue(beforeRow.value)
      : {};
    const beforeMerged = mergePlayerInfoPagesWithDefaults(beforeParsed);
    const jsonValue = JSON.stringify(validation.pages);

    await prisma.setting.upsert({
      where: { key: PLAYER_INFO_PAGES_SETTING_KEY },
      create: {
        key: PLAYER_INFO_PAGES_SETTING_KEY,
        value: jsonValue,
      },
      update: { value: jsonValue },
    });

    await logAuditEvent({
      req,
      action: "CMS_PLAYER_INFO_PAGES_UPDATED",
      module: "CMS",
      entityType: "SETTING",
      entityId: PLAYER_INFO_PAGES_SETTING_KEY,
      before: { pages: beforeMerged },
      after: { pages: validation.pages },
    });

    return res.json({
      message: "Player info pages updated",
      pages: validation.pages,
      configuredInDatabase: true,
    });
  } catch (error) {
    console.error("putPlayerInfoPages error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update player info pages" });
  }
}

// ─── Player site branding — navbar + loading logos (CMS) ───────────────────

export async function getPlayerSiteBranding(_req, res) {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: PLAYER_SITE_BRANDING_SETTING_KEY },
    });
    const branding = row ? parsePlayerSiteBrandingValue(row.value) : {};
    return res.json({
      ...branding,
      configuredInDatabase: Boolean(row),
    });
  } catch (error) {
    console.error("getPlayerSiteBranding error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load player site branding" });
  }
}

export async function putPlayerSiteBranding(req, res) {
  try {
    const validation = validatePlayerSiteBrandingPayload(req.body ?? {});
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: PLAYER_SITE_BRANDING_SETTING_KEY },
    });
    const beforeBranding = beforeRow
      ? parsePlayerSiteBrandingValue(beforeRow.value)
      : {};
    const jsonValue = JSON.stringify(validation.branding);

    await prisma.setting.upsert({
      where: { key: PLAYER_SITE_BRANDING_SETTING_KEY },
      create: {
        key: PLAYER_SITE_BRANDING_SETTING_KEY,
        value: jsonValue,
      },
      update: { value: jsonValue },
    });

    await logAuditEvent({
      req,
      action: "CMS_PLAYER_SITE_BRANDING_UPDATED",
      module: "CMS",
      entityType: "SETTING",
      entityId: PLAYER_SITE_BRANDING_SETTING_KEY,
      before: { branding: beforeBranding },
      after: { branding: validation.branding },
    });

    return res.json({
      message: "Player site branding updated",
      ...validation.branding,
      configuredInDatabase: true,
    });
  } catch (error) {
    console.error("putPlayerSiteBranding error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update player site branding" });
  }
}

// ─── Generic all-settings dump ───────────────────────────────────────────────

/** GET /api/admin/settings — returns every setting in the table. */
export async function listAllSettings(_req, res) {
  try {
    const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    const map = {};
    for (const row of rows) map[row.key] = row.value;
    return res.json(map);
  } catch (error) {
    console.error("listAllSettings error:", error);
    return res.status(500).json({ message: "Failed to list settings" });
  }
}
