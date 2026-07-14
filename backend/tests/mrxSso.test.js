/**
 * Unit tests for MRX SSO encrypt/decrypt.
 * Run: node --test backend/tests/mrxSso.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  encryptMrxSsoToken,
  decryptMrxSsoToken,
} from "../lib/mrxSso.js";

const TEST_KEY =
  "a1b6783d4e5f6789012345901234567890123456789901234567890123456782";

before(() => {
  process.env.MRX_ENCRYPTION_KEY = TEST_KEY;
});

after(() => {
  delete process.env.MRX_ENCRYPTION_KEY;
});

test("encryptMrxSsoToken returns iv:ciphertext hex format", () => {
  const token = encryptMrxSsoToken({
    phone: "251911223344",
    name: "Test Player",
    timestamp: 1_700_000_000_000,
  });
  assert.match(token, /^[0-9a-f]+:[0-9a-f]+$/i);
  const [iv, cipher] = token.split(":");
  assert.equal(iv.length, 32); // 16 bytes
  assert.ok(cipher.length > 0);
});

test("round-trip decrypt yields local phone + name + timestamp", () => {
  const timestamp = 1_700_000_000_000;
  const token = encryptMrxSsoToken({
    phone: "251911223344",
    name: "Abebe Kebede",
    timestamp,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.phone, "0911223344");
  assert.equal(payload.name, "Abebe Kebede");
  assert.equal(payload.timestamp, timestamp);
});

test("local 09 phone is left in local form in payload", () => {
  const token = encryptMrxSsoToken({
    phone: "0911223344",
    name: "Player",
    timestamp: 1,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.phone, "0911223344");
});

test("missing key throws", () => {
  const prev = process.env.MRX_ENCRYPTION_KEY;
  delete process.env.MRX_ENCRYPTION_KEY;
  assert.throws(
    () => encryptMrxSsoToken({ phone: "0911", name: "x" }),
    /MRX_ENCRYPTION_KEY/,
  );
  process.env.MRX_ENCRYPTION_KEY = prev;
});
