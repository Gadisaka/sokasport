/**
 * Unit tests for MRX SSO encrypt/decrypt (matches MRX playerSso.js).
 * Run: node --test backend/tests/mrxSso.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  encryptMrxSsoToken,
  decryptMrxSsoToken,
  getMrxEncryptionKeyBuffer,
} from "../lib/mrxSso.js";

const TEST_KEY =
  "a1b6783d4e5f6789012345901234567890123456789901234567890123456782";

before(() => {
  process.env.MRX_ENCRYPTION_KEY = TEST_KEY;
});

after(() => {
  delete process.env.MRX_ENCRYPTION_KEY;
});

test("key derivation matches playerSso.js (slice 0,64 as hex)", () => {
  const expected = Buffer.from(TEST_KEY.slice(0, 64), "hex");
  assert.deepEqual(getMrxEncryptionKeyBuffer(), expected);
  assert.equal(getMrxEncryptionKeyBuffer().length, 32);
});

test("encryptMrxSsoToken returns iv:ciphertext hex format", () => {
  const token = encryptMrxSsoToken({
    phone: "251911223344",
    name: "Test Player",
    timestamp: 1_700_000_000_000,
  });
  assert.match(token, /^[0-9a-f]+:[0-9a-f]+$/i);
  const [iv, cipher] = token.split(":");
  assert.equal(iv.length, 32);
  assert.ok(cipher.length > 0);
});

test("round-trip preserves phone as passed (no reformatting)", () => {
  const timestamp = 1_700_000_000_000;
  const token = encryptMrxSsoToken({
    phone: "251911223344",
    name: "Abebe Kebede",
    balance: 1060,
    timestamp,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.phone, "251911223344");
  assert.equal(payload.name, "Abebe Kebede");
  assert.equal(payload.balance, 1060);
  assert.equal(payload.timestamp, timestamp);
});

test("payload uses name fallback to phone when name empty", () => {
  const token = encryptMrxSsoToken({
    phone: "0911223344",
    name: "",
    timestamp: 1,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.phone, "0911223344");
  assert.equal(payload.name, "0911223344");
  assert.equal(payload.balance, 0);
});

test("falls back to default key when env unset", () => {
  delete process.env.MRX_ENCRYPTION_KEY;
  const token = encryptMrxSsoToken({
    phone: "0911223344",
    name: "Player",
    balance: 250.5,
    timestamp: 42,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.phone, "0911223344");
  assert.equal(payload.balance, 250.5);
  assert.equal(payload.timestamp, 42);
  process.env.MRX_ENCRYPTION_KEY = TEST_KEY;
});

test("round-trip preserves balance field", () => {
  const token = encryptMrxSsoToken({
    phone: "251911556677",
    name: "Test Player",
    balance: 1000,
    timestamp: 99,
  });
  const payload = decryptMrxSsoToken(token);
  assert.equal(payload.balance, 1000);
});
