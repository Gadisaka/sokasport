import { Router } from "express";
import { prisma } from "../Config/db.js";
import {
  HOME_HERO_BANNERS_SETTING_KEY,
  parseHomeHeroBannersValue,
} from "../lib/homeHeroBanners.js";
import {
  PLAYER_INFO_PAGES_SETTING_KEY,
  mergePlayerInfoPagesWithDefaults,
  parsePlayerInfoPagesValue,
} from "../lib/playerInfoPages.js";
import {
  PLAYER_SITE_BRANDING_SETTING_KEY,
  parsePlayerSiteBrandingValue,
} from "../lib/playerSiteBranding.js";
import { resolveBettingLimits } from "../lib/bettingLimits.js";
import {
  parseReceiversSetting,
  ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
} from "../lib/onlineDepositReceiversConfig.js";
import { resolveCancelWindowMinutes } from "../lib/ticketCancelWindow.js";
import { resolveWinningsTax } from "../lib/winningsTax.js";
import { getPublicCouponTicket } from "../controllers/ticketsController.js";

const router = Router();

router.get("/hero-banners", async (_req, res) => {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: HOME_HERO_BANNERS_SETTING_KEY },
    });
    const urls = row ? parseHomeHeroBannersValue(row.value) : [];
    return res.json({ urls });
  } catch (error) {
    console.error("cmsPublic hero-banners error:", error);
    return res.status(500).json({ message: "Failed to load banners" });
  }
});

router.get("/player-info-pages", async (_req, res) => {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: PLAYER_INFO_PAGES_SETTING_KEY },
    });
    const parsed = row ? parsePlayerInfoPagesValue(row.value) : {};
    const pages = mergePlayerInfoPagesWithDefaults(parsed);
    return res.json({ pages });
  } catch (error) {
    console.error("cmsPublic player-info-pages error:", error);
    return res.status(500).json({ message: "Failed to load info pages" });
  }
});

router.get("/site-branding", async (_req, res) => {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: PLAYER_SITE_BRANDING_SETTING_KEY },
    });
    const b = row ? parsePlayerSiteBrandingValue(row.value) : {};
    return res.json({
      navbarWide: b.navbarWide ?? "",
      navbarCompact: b.navbarCompact ?? "",
      loadingLogo: b.loadingLogo ?? "",
    });
  } catch (error) {
    console.error("cmsPublic site-branding error:", error);
    return res.status(500).json({ message: "Failed to load site branding" });
  }
});

/** Public sportsbook: lookup ticket by coupon for check / replay slip flows. */
router.get("/ticket-by-coupon", getPublicCouponTicket);

/** Public sportsbook UX: numeric limits + effective cancel window (minutes). */
router.get("/platform-config", async (_req, res) => {
  try {
    const [limits, ticketCancelWindowMinutes, receiversRow, winningsTax] =
      await Promise.all([
        resolveBettingLimits(prisma),
        resolveCancelWindowMinutes(prisma),
        prisma.setting.findUnique({
          where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
        }),
        resolveWinningsTax(prisma),
      ]);
    const onlineDepositReceivers = parseReceiversSetting(receiversRow?.value);
    return res.json({
      limits,
      ticketCancelWindowMinutes,
      onlineDepositReceivers,
      winningsTax: {
        enabled: winningsTax.enabled,
        rate: winningsTax.rate,
      },
    });
  } catch (error) {
    console.error("cmsPublic platform-config error:", error);
    return res.status(500).json({ message: "Failed to load platform config" });
  }
});

export default router;
