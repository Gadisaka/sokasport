/**
 * Allowed browser origins for CORS + credential cookies (admin device_token).
 *
 * Set CORS_ORIGINS as a comma-separated list in production, e.g.:
 *   CORS_ORIGINS=https://sokasport.com,https://admin.sokasport.com
 *
 * ADMIN_ORIGIN / FRONTEND_ORIGIN are merged for backward compatibility.
 */
function parseOriginList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getAllowedCorsOrigins() {
  const origins = new Set([
    ...parseOriginList(process.env.CORS_ORIGINS),
    ...parseOriginList(process.env.CORS_ORIGIN),
  ]);

  if (process.env.ADMIN_ORIGIN) {
    origins.add(String(process.env.ADMIN_ORIGIN).trim());
  }
  if (process.env.FRONTEND_ORIGIN) {
    origins.add(String(process.env.FRONTEND_ORIGIN).trim());
  }

  if (origins.size === 0) {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:5174");
  }

  return [...origins];
}

export function createCorsOptions() {
  const allowedOrigins = getAllowedCorsOrigins();

  return {
    origin(origin, callback) {
      // Server-to-server, curl, Postman — no Origin header
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  };
}
