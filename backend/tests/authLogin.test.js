/**
 * Unit tests for staff/player login identifier rules.
 * Run: node --test backend/tests/authLogin.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLoginPathAllowed,
  resolveLoginIdentifier,
} from "../lib/loginIdentifier.js";
import { validateUsername } from "../lib/username.js";

test("staff login identifier resolves username", () => {
  const resolved = resolveLoginIdentifier({
    username: "Admin_User",
    password: "x",
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.mode, "username");
  assert.equal(resolved.username, "admin_user");
});

test("player login identifier resolves phone", () => {
  const resolved = resolveLoginIdentifier({ phone: "0911223344" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.mode, "phone");
  assert.equal(resolved.phone, "251911223344");
});

test("reject when both username and phone are sent", () => {
  const resolved = resolveLoginIdentifier({
    username: "admin",
    phone: "0911111111",
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.message, /exactly one/i);
});

test("reject missing identifier", () => {
  const resolved = resolveLoginIdentifier({ password: "secret" });
  assert.equal(resolved.ok, false);
});

test("staff can use username path; players cannot", () => {
  assert.equal(isLoginPathAllowed("username", "ADMIN"), true);
  assert.equal(isLoginPathAllowed("username", "CASHIER"), true);
  assert.equal(isLoginPathAllowed("username", "PLAYER"), false);
});

test("players can use phone path; staff cannot", () => {
  assert.equal(isLoginPathAllowed("phone", "PLAYER"), true);
  assert.equal(isLoginPathAllowed("phone", "ADMIN"), false);
  assert.equal(isLoginPathAllowed("phone", "CASHIER"), false);
});

test("invalid username format rejected on staff create", () => {
  assert.equal(validateUsername("ab").ok, false);
  assert.equal(validateUsername("!!!").ok, false);
  assert.equal(validateUsername("valid_user").ok, true);
});
