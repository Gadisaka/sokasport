import express from "express";
import {
  getBettingLimits,
  getCashoutMargin,
  getHomeHeroBanners,
  getOnlineDepositReceivers,
  getPlayerInfoPages,
  getPlayerSiteBranding,
  getTicketCancelWindow,
  getWinningsTax,
  listAllSettings,
  putBettingLimits,
  putCashoutMargin,
  putHomeHeroBanners,
  putOnlineDepositReceivers,
  putPlayerInfoPages,
  putPlayerSiteBranding,
  putTicketCancelWindow,
  putWinningsTax,
} from "../controllers/settingsController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authorizePermission("settings:read"), listAllSettings);
router.get("/ticket-cancel-window", authorizePermission("settings:read"), getTicketCancelWindow);
router.put("/ticket-cancel-window", authorizePermission("settings:update"), putTicketCancelWindow);
router.get("/cashout-margin", authorizePermission("settings:read"), getCashoutMargin);
router.put("/cashout-margin", authorizePermission("settings:update"), putCashoutMargin);
router.get("/winnings-tax", authorizePermission("settings:read"), getWinningsTax);
router.put("/winnings-tax", authorizePermission("settings:update"), putWinningsTax);
router.get("/betting-limits", authorizePermission("settings:read"), getBettingLimits);
router.put("/betting-limits", authorizePermission("settings:update"), putBettingLimits);
router.get("/online-deposit-receivers", authorizePermission("settings:read"), getOnlineDepositReceivers);
router.put("/online-deposit-receivers", authorizePermission("settings:update"), putOnlineDepositReceivers);
router.get("/home-hero-banners", authorizePermission("settings:read"), getHomeHeroBanners);
router.put("/home-hero-banners", authorizePermission("settings:update"), putHomeHeroBanners);
router.get("/player-info-pages", authorizePermission("settings:read"), getPlayerInfoPages);
router.put("/player-info-pages", authorizePermission("settings:update"), putPlayerInfoPages);
router.get("/player-site-branding", authorizePermission("settings:read"), getPlayerSiteBranding);
router.put("/player-site-branding", authorizePermission("settings:update"), putPlayerSiteBranding);

export default router;
