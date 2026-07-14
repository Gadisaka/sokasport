/**
 * Unit tests for MRX wallet reference helpers + body validation.
 * Run: node --test backend/tests/mrxWallet.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feeRef,
  winRef,
  parseAdjustBalanceBody,
} from "../lib/mrxWalletRefs.js";

test("feeRef namespaces bare ids and preserves mrx: prefix", () => {
  assert.equal(feeRef("abc-123"), "mrx:fee:abc-123");
  assert.equal(feeRef("mrx:fee:abc-123"), "mrx:fee:abc-123");
});

test("winRef namespaces bare ids and preserves mrx: prefix", () => {
  assert.equal(winRef("xyz"), "mrx:win:xyz");
  assert.equal(winRef("mrx:win:xyz"), "mrx:win:xyz");
});

test("parseAdjustBalanceBody rejects missing fields", () => {
  const parsed = parseAdjustBalanceBody({ phone: "0911" });
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /required/i);
});

test("parseAdjustBalanceBody rejects invalid type", () => {
  const parsed = parseAdjustBalanceBody({
    phone: "0911223344",
    type: "DEPOSIT",
    amount: 10,
  });
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /GAME_FEE|GAME_WINNING/);
});

test("parseAdjustBalanceBody rejects non-positive amount", () => {
  const parsed = parseAdjustBalanceBody({
    phone: "0911223344",
    type: "GAME_FEE",
    amount: 0,
  });
  assert.equal(parsed.ok, false);
});

test("parseAdjustBalanceBody accepts valid GAME_FEE with reference", () => {
  const parsed = parseAdjustBalanceBody({
    phone: "0911223344",
    type: "GAME_FEE",
    amount: 25.5,
    reference: "ext-1",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, "GAME_FEE");
  assert.equal(parsed.amount, 25.5);
  assert.equal(parsed.referenceId, "ext-1");
});

test("parseAdjustBalanceBody generates reference when omitted", () => {
  const parsed = parseAdjustBalanceBody({
    phone: "0911223344",
    type: "GAME_WINNING",
    amount: 10,
  });
  assert.equal(parsed.ok, true);
  assert.match(parsed.referenceId, /^0911223344-\d+$/);
});
