import { getApiKey } from "./config.js";

const PUBLIC_PATHS = new Set(["/health", "/version"]);

/**
 * Require X-Printer-Key on all routes except /health and /version.
 */
export function createAuthMiddleware() {
  return (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) {
      next();
      return;
    }

    const provided = String(req.headers["x-printer-key"] || "").trim();
    const expected = getApiKey();

    if (!provided || provided !== expected) {
      res.status(401).json({
        success: false,
        code: "unauthorized",
        message: "Invalid or missing X-Printer-Key",
      });
      return;
    }

    next();
  };
}
