import test from "node:test";
import assert from "node:assert/strict";
import { resolveMarketState } from "../services/odds-engine/marketState.js";

test("resolveMarketState respects explicit LOCKED operator state", () => {
  const state = resolveMarketState({
    fixtureStatus: "LIVE",
    hasOddLine: true,
    operatorState: "LOCKED",
  });
  assert.equal(state, "LOCKED");
});

test("resolveMarketState returns SUSPENDED when odd line missing", () => {
  const state = resolveMarketState({
    fixtureStatus: "LIVE",
    hasOddLine: false,
  });
  assert.equal(state, "SUSPENDED");
});

