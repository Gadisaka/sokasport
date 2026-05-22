/**
 * Placement-time validation through the V2 market registry.
 *
 * These tests exercise the registry contract directly — the
 * equivalent of what `createTicket` / `createPrebookTicket` invoke
 * via `normalizeSelectionForV2()` when `PLACEMENT_VALIDATION=v2`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MARKET_REGISTRY } from "../services/markets/registry.js";
import {
  ValidationError,
  MarketUnknownError,
} from "../services/markets/errors.js";

test("resolveCode accepts canonical code", () => {
  assert.equal(MARKET_REGISTRY.resolveCode("MATCH_WINNER"), "MATCH_WINNER");
});

test("resolveCode accepts alias '1X2' → MATCH_WINNER", () => {
  assert.equal(MARKET_REGISTRY.resolveCode("1X2"), "MATCH_WINNER");
});

test("resolveCode returns null for junk", () => {
  assert.equal(MARKET_REGISTRY.resolveCode("RANDOM_NOISE"), null);
});

test("validate: MATCH_WINNER canonicalizes '1' to { side: 'HOME' }", () => {
  assert.deepEqual(
    MARKET_REGISTRY.validate("MATCH_WINNER", { side: "1" }, {}),
    { side: "HOME" },
  );
});

test("validate: unknown market throws MarketUnknownError with .code='unknown_market'", () => {
  assert.throws(
    () => MARKET_REGISTRY.validate("NOPE", {}, {}),
    (err) => err instanceof MarketUnknownError && err.code === "unknown_market",
  );
});

test("validate: OVER_UNDER without line throws ValidationError with .code='invalid_line'", () => {
  assert.throws(
    () => MARKET_REGISTRY.validate("OVER_UNDER", { side: "OVER" }, {}),
    (err) => err instanceof ValidationError && err.code === "invalid_line",
  );
});

test("validate: CORRECT_SCORE enforces non-negative scores", () => {
  assert.throws(
    () => MARKET_REGISTRY.validate("CORRECT_SCORE", { home: -1, away: 0 }, {}),
    (err) => err instanceof ValidationError && err.code === "invalid_home",
  );
});

test("validate: GOALSCORER_ANYTIME requires playerId", () => {
  assert.throws(
    () => MARKET_REGISTRY.validate("GOALSCORER_ANYTIME", {}, {}),
    (err) => err instanceof ValidationError && err.code === "missing_player_id",
  );
});

test("registry has no duplicate codes and includes API-Sports catalogue markets", () => {
  const codes = MARKET_REGISTRY.codes();
  assert.equal(codes.length, new Set(codes).size);
  assert.ok(
    codes.length >= 120,
    `expected>=120 markets (markets.md catalogue); got ${codes.length}`,
  );
});

test("resolveCode maps API bet id string before textual aliases", () => {
  assert.equal(MARKET_REGISTRY.resolveCode("12"), "DOUBLE_CHANCE");
});

test("resolveCode accepts BET_ prefix bet ids", () => {
  assert.equal(MARKET_REGISTRY.resolveCode("BET_1"), "MATCH_WINNER");
});
