/**
 * Run: node --test backend/tests/username.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUsername,
  validateUsername,
  suggestUsernameFromUser,
} from "../lib/username.js";

test("normalizeUsername lowercases and strips invalid chars", () => {
  assert.equal(normalizeUsername("Admin_User"), "admin_user");
  assert.equal(normalizeUsername("  Foo-Bar!  "), "foobar");
  assert.equal(normalizeUsername(""), "");
});

test("validateUsername accepts valid staff usernames", () => {
  const ok = validateUsername("cashier_01");
  assert.equal(ok.ok, true);
  assert.equal(ok.username, "cashier_01");
});

test("validateUsername rejects too short or invalid", () => {
  assert.equal(validateUsername("ab").ok, false);
  assert.equal(validateUsername("!!!").ok, false);
  assert.equal(validateUsername("").ok, false);
  assert.equal(validateUsername("a".repeat(33)).ok, false);
});

test("suggestUsernameFromUser prefers email local-part", () => {
  assert.equal(
    suggestUsernameFromUser({ email: "Cashier.One@test.local", id: "abc" }),
    "cashierone",
  );
});

test("suggestUsernameFromUser falls back to phone then id", () => {
  // last 8 digits of 251911223344 → 11223344
  assert.equal(
    suggestUsernameFromUser({ phone: "251911223344" }),
    "11223344",
  );
  assert.match(suggestUsernameFromUser({ id: "AbCdEfGhIj" }), /^user_/);
});
