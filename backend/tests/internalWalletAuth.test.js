/**
 * Unit tests for MRX internal API key middleware.
 * Run: node --test backend/tests/internalWalletAuth.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { verifyInternalBridgeKey } from "../middleware/internalBridgeAuth.js";

const BRIDGE_KEY = "test-mrx-internal-bridge-key";

before(() => {
  process.env.INTERNAL_BRIDGE_KEY = BRIDGE_KEY;
});

after(() => {
  delete process.env.INTERNAL_BRIDGE_KEY;
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("missing x-api-key returns 403", () => {
  const res = mockRes();
  let nextCalled = false;
  verifyInternalBridgeKey({ headers: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(nextCalled, false);
});

test("wrong x-api-key returns 403", () => {
  const res = mockRes();
  let nextCalled = false;
  verifyInternalBridgeKey(
    { headers: { "x-api-key": "wrong" } },
    res,
    () => {
      nextCalled = true;
    },
  );
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("matching x-api-key calls next", () => {
  const res = mockRes();
  let nextCalled = false;
  verifyInternalBridgeKey(
    { headers: { "x-api-key": BRIDGE_KEY } },
    res,
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("unset INTERNAL_BRIDGE_KEY rejects even with header", () => {
  delete process.env.INTERNAL_BRIDGE_KEY;
  const res = mockRes();
  let nextCalled = false;
  verifyInternalBridgeKey(
    { headers: { "x-api-key": BRIDGE_KEY } },
    res,
    () => {
      nextCalled = true;
    },
  );
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  process.env.INTERNAL_BRIDGE_KEY = BRIDGE_KEY;
});
