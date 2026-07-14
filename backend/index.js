import "dotenv/config";
import compression from "compression";
import cors from "cors";
import express from "express";
import http from "node:http";
import { prisma } from "./Config/db.js";
import authRoutes from "./routes/auth.js";
import gamesRoutes from "./routes/games.js";
import adminFixturesRoutes from "./routes/adminFixtures.js";
import playerRoutes from "./routes/player.js";
import settingsRoutes from "./routes/settings.js";
import ticketsRoutes from "./routes/tickets.js";
import usersRoutes from "./routes/users.js";
import walletRoutes from "./routes/wallet.js";
import cashierWalletRoutes from "./routes/cashierWallet.js";
import agentsCashiersRoutes from "./routes/agentsCashiers.js";
import auditLogsRoutes from "./routes/auditLogs.js";
import dummyMatchesRoutes from "./routes/dummyMatches.js";
import footballPublicRoutes from "./routes/footballPublic.js";
import betsRoutes from "./routes/bets.js";
import agentRoutes from "./routes/agent.js";
import financeRoutes from "./routes/finance.js";
import adminInsightsRoutes from "./routes/adminInsights.js";
import adminValidationRoutes from "./routes/adminValidation.js";
import adminReportsRoutes from "./routes/adminReports.js";
import apiConfigRoutes from "./routes/apiConfig.js";
import uploadRoutes from "./routes/upload.js";
import cmsPublicRoutes from "./routes/cmsPublic.js";
import bonusesRoutes from "./routes/bonuses.js";
import notificationsRoutes from "./routes/notifications.js";
import adminNotificationsRoutes from "./routes/adminNotifications.js";
import adminCashierDevicesRoutes from "./routes/adminCashierDevices.js";
import inoutRoutes from "./routes/inout.js";
import casinoRoutes from "./routes/casino.js";
import casinoPublicRoutes from "./routes/casinoPublic.js";
import casinoAdminRoutes from "./routes/casinoAdmin.js";
import { startCronJobs } from "./jobs/index.js";
import { runBootstrap } from "./jobs/bootstrap.js";
import { authenticateToken } from "./middleware/auth.js";
import { pingRedis } from "./services/cacheService.js";
import { refreshFixturesByDateCaches } from "./services/fixturesListService.js";
import { initSocketHub } from "./lib/socketHub.js";
import { createCorsOptions } from "./lib/corsConfig.js";
import { perfTimingMiddleware } from "./middleware/perfTiming.js";

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);

// InOut webhooks need the raw request body for HMAC signature verification,
// so this router (which uses its own express.raw parser) MUST be mounted
// before the global express.json() below.
app.use("/api/integrations/inout", inoutRoutes);

app.use(compression());
app.use(express.json());
app.use(perfTimingMiddleware);

app.get("/health", async (_req, res) => {
  const redis = await pingRedis();
  res.json({ status: "ok", redis: redis ? "up" : "down" });
});
// CORS — allowlist required for admin httpOnly device_token cookies (credentials)
app.use(cors(createCorsOptions()));

// --- Public ---
app.use("/api/auth", authRoutes);
app.use("/api/dummy", dummyMatchesRoutes);
app.use("/api/football", footballPublicRoutes);
app.use("/api/bets", betsRoutes);
app.use("/api/cms", cmsPublicRoutes);
app.use("/api/casino", casinoPublicRoutes);

// --- Authenticated ---
app.use("/api/admin/users", authenticateToken, usersRoutes);
app.use("/api/admin/settings", authenticateToken, settingsRoutes);
app.use("/api/admin/bonuses", authenticateToken, bonusesRoutes);
app.use("/api/admin/upload", authenticateToken, uploadRoutes);
app.use("/api/admin/wallet", authenticateToken, walletRoutes);
app.use("/api/cashier/wallet", authenticateToken, cashierWalletRoutes);
app.use("/api/admin/games", authenticateToken, gamesRoutes);
app.use("/api/admin/fixtures", authenticateToken, adminFixturesRoutes);
app.use("/api/admin/agents-cashiers", authenticateToken, agentsCashiersRoutes);
app.use("/api/admin/audit-logs", authenticateToken, auditLogsRoutes);
app.use("/api/admin/finance", authenticateToken, financeRoutes);
app.use("/api/admin/insights", authenticateToken, adminInsightsRoutes);
app.use("/api/admin/validation", authenticateToken, adminValidationRoutes);
app.use("/api/admin/reports", authenticateToken, adminReportsRoutes);
app.use("/api/admin/api-config", authenticateToken, apiConfigRoutes);
app.use("/api/agent", authenticateToken, agentRoutes);
app.use("/api/tickets", authenticateToken, ticketsRoutes);
app.use("/api/player", authenticateToken, playerRoutes);
app.use("/api/casino", authenticateToken, casinoRoutes);
app.use("/api/admin/casino", authenticateToken, casinoAdminRoutes);
app.use("/api/notifications", authenticateToken, notificationsRoutes);
app.use("/api/admin/notifications", authenticateToken, adminNotificationsRoutes);
app.use(
  "/api/admin/cashier-devices",
  authenticateToken,
  adminCashierDevicesRoutes,
);

app.get("/api/protected", authenticateToken, (req, res) => {
  res.json({
    message: "You are authenticated",
    user: req.user,
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) {
    return;
  }
  res.status(error?.status || 500).json({
    message: "Internal server error",
  });
});

await prisma.$connect();
console.log("MongoDB connected via Prisma");

const redisOk = await pingRedis();
if (redisOk) {
  console.log("Redis connected – caching enabled");
} else {
  console.warn(
    "Redis not reachable – app will run without cache (set REDIS_URL or start redis-server)",
  );
}

await initSocketHub(server);

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

/** Keep home-page fixtures-by-date caches warm independent of sync jobs. */
const FIXTURES_WARM_INTERVAL_MS = Number(
  process.env.FIXTURES_WARM_INTERVAL_MS || 10 * 60 * 1000,
);

function warmFixturesByDateCaches(reason) {
  refreshFixturesByDateCaches()
    .then((results) => {
      console.log(
        `[fixturesList] warm (${reason}):`,
        (results || [])
          .map((r) => `${r.ymd}=${r.count ?? r.error}`)
          .join(", ") || "ok",
      );
    })
    .catch((err) => {
      console.error(
        `[fixturesList] warm (${reason}) failed:`,
        err?.message || err,
      );
    });
}

warmFixturesByDateCaches("startup");
if (FIXTURES_WARM_INTERVAL_MS > 0) {
  setInterval(
    () => warmFixturesByDateCaches("interval"),
    FIXTURES_WARM_INTERVAL_MS,
  ).unref?.();
}

if (process.env.ENABLE_API_FOOTBALL_CRON === "true") {
  // Default path: bootstrap enqueues an initial bulk fixtures job and the
  // dedicated worker (`npm run worker`) owns the cadence. The legacy
  // RUN_WORKER_INLINE path keeps node-cron alive in the API process for
  // single-process dev environments.
  runBootstrap({
    force: process.env.FORCE_BOOTSTRAP === "true",
  })
    .catch((err) => console.error("[bootstrap] fatal:", err))
    .finally(() => {
      startCronJobs();
    });
}
