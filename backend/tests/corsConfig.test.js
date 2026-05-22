import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedCorsOrigins } from "../lib/corsConfig.js";

test("getAllowedCorsOrigins merges CORS_ORIGINS and legacy vars", () => {
  const prev = {
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    ADMIN_ORIGIN: process.env.ADMIN_ORIGIN,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  };

  process.env.CORS_ORIGINS = "https://sokasport.com,https://admin.sokasport.com";
  process.env.ADMIN_ORIGIN = "https://admin.sokasport.com";
  process.env.FRONTEND_ORIGIN = "https://sokasport.com";
  delete process.env.CORS_ORIGIN;

  const origins = getAllowedCorsOrigins();
  assert.ok(origins.includes("https://sokasport.com"));
  assert.ok(origins.includes("https://admin.sokasport.com"));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
