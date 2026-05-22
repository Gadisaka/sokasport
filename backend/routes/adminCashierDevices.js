import express from "express";
import {
  approveDeviceRequest,
  listPendingDeviceApprovals,
  listTrustedDevices,
  rejectDeviceRequest,
  revokeDevice,
} from "../controllers/adminCashierDevicesController.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/pending",
  authorizePermission("devices:pending"),
  listPendingDeviceApprovals,
);
router.get(
  "/trusted",
  authorizePermission("devices:read"),
  listTrustedDevices,
);
router.patch(
  "/pending/:id/approve",
  authorizePermission("devices:approve"),
  approveDeviceRequest,
);
router.patch(
  "/pending/:id/reject",
  authorizePermission("devices:reject"),
  rejectDeviceRequest,
);
router.delete(
  "/trusted/:id",
  authorizePermission("devices:revoke"),
  revokeDevice,
);

export default router;
