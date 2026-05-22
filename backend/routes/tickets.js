import express from "express";
import {
  cancelTicket,
  confirmPrintTicket,
  createTicket,
  getTicketById,
  getTicketByReceipt,
  listTickets,
  payoutTicket,
  updateTicketStake,
  voidTicket,
} from "../controllers/ticketsController.js";
import {
  executeTicketCashout,
  quoteTicketCashout,
} from "../controllers/cashoutController.js";
import { authorizePermission } from "../middleware/auth.js";
import { createSportsbookRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/", authorizePermission("tickets:read"), listTickets);
router.get(
  "/by-receipt",
  authorizePermission("tickets:read"),
  getTicketByReceipt,
);
router.get("/:id", authorizePermission("tickets:read"), getTicketById);

router.post("/", authorizePermission("tickets:create"), createTicket);
router.patch(
  "/:id/stake",
  authorizePermission("tickets:create"),
  updateTicketStake,
);
router.patch(
  "/:id/confirm-print",
  authorizePermission("tickets:create"),
  createSportsbookRateLimiter("cashier_confirm_print"),
  confirmPrintTicket,
);
router.patch(
  "/:id/cancel",
  authorizePermission("tickets:cancel"),
  cancelTicket,
);
router.patch("/:id/void", authorizePermission("tickets:void"), voidTicket);
router.patch(
  "/:id/payout",
  authorizePermission("tickets:payout"),
  payoutTicket,
);
router.get(
  "/:id/cashout-quote",
  authorizePermission("cashout:execute"),
  quoteTicketCashout,
);
router.post(
  "/:id/cashout",
  authorizePermission("cashout:execute"),
  executeTicketCashout,
);

export default router;
