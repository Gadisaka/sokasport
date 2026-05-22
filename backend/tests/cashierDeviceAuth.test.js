import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDeviceTrust,
  extractClientMeta,
  getCookie,
  hashIdentifier,
} from "../lib/cashierDeviceAuth.js";

test("hashIdentifier returns stable sha256 hex", () => {
  const first = hashIdentifier("visitor-123");
  const second = hashIdentifier("visitor-123");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.equal(hashIdentifier(null), null);
});

test("getCookie parses cookie header values", () => {
  const req = {
    headers: {
      cookie: "device_token=abc123; other=value",
    },
  };
  assert.equal(getCookie(req, "device_token"), "abc123");
  assert.equal(getCookie(req, "missing"), null);
});

test("extractClientMeta prefers x-forwarded-for", () => {
  const req = {
    headers: {
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      "user-agent": "TestAgent/1.0",
    },
    socket: { remoteAddress: "::1" },
  };
  assert.deepEqual(extractClientMeta(req), {
    ip: "203.0.113.1",
    userAgent: "TestAgent/1.0",
  });
});

test("evaluateDeviceTrust allows exact device match", () => {
  const fingerprintHash = hashIdentifier("fp-1");
  const tokenHash = hashIdentifier("token-1");
  const trustedDevice = {
    is_active: true,
    fingerprint_hash: fingerprintHash,
    device_token_hash: tokenHash,
  };

  const result = evaluateDeviceTrust({
    trustedDevice,
    fingerprintHash,
    deviceTokenHash: tokenHash,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "DEVICE_MATCH");
});

test("evaluateDeviceTrust allows token match with fingerprint drift", () => {
  const tokenHash = hashIdentifier("token-1");
  const trustedDevice = {
    is_active: true,
    fingerprint_hash: hashIdentifier("old-fp"),
    device_token_hash: tokenHash,
  };

  const result = evaluateDeviceTrust({
    trustedDevice,
    fingerprintHash: hashIdentifier("new-fp"),
    deviceTokenHash: tokenHash,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "TOKEN_MATCH_FINGERPRINT_DRIFT");
  assert.equal(result.updateFingerprint, true);
});

test("evaluateDeviceTrust blocks unknown device", () => {
  const trustedDevice = {
    is_active: true,
    fingerprint_hash: hashIdentifier("fp-1"),
    device_token_hash: hashIdentifier("token-1"),
  };

  const result = evaluateDeviceTrust({
    trustedDevice,
    fingerprintHash: hashIdentifier("fp-2"),
    deviceTokenHash: hashIdentifier("token-2"),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "DEVICE_MISMATCH");
});

test("evaluateDeviceTrust requires fingerprint", () => {
  const result = evaluateDeviceTrust({
    trustedDevice: { is_active: true },
    fingerprintHash: null,
    deviceTokenHash: hashIdentifier("token-1"),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "MISSING_FINGERPRINT");
});

test("evaluateDeviceTrust treats missing trusted device as blocked", () => {
  const result = evaluateDeviceTrust({
    trustedDevice: null,
    fingerprintHash: hashIdentifier("fp-1"),
    deviceTokenHash: hashIdentifier("token-1"),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "NO_TRUSTED_DEVICE");
});

test("cashier_login rate limit uses stricter policy", async () => {
  const { getRateLimitPolicyForTests } = await import("../middleware/rateLimit.js");
  const policy = getRateLimitPolicyForTests("cashier_login", "anon");
  assert.equal(policy.limit, 10);
  assert.equal(policy.windowSec, 900);
});
