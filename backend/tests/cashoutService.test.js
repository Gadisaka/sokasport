import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCashoutQuote,
  computeCashoutAmount,
  evaluateCashoutEligibility,
} from "../services/cashoutService.js";

function makeSelection({
  result = "PENDING",
  odds = 1.5,
  fixtureStatus = "NS",
  startTime = "2026-04-28T10:00:00.000Z",
} = {}) {
  return {
    result,
    odds,
    fixture: {
      status: fixtureStatus,
      start_time: startTime,
    },
    match: null,
  };
}

test("computeCashoutAmount uses only won selection odds", () => {
  const output = computeCashoutAmount({
    stake: 100,
    margin: 0.5,
    selections: [
      makeSelection({ result: "WON", odds: 1.8 }),
      makeSelection({ result: "WON", odds: 2.0 }),
      makeSelection({ result: "PENDING", odds: 1.7 }),
    ],
  });
  assert.equal(output.currentOdds, 3.6);
  assert.equal(output.amount, 180);
});

test("standard profile allows partial-progress ticket", () => {
  const result = evaluateCashoutEligibility(
    {
      status: "OPEN",
      selections: [
        makeSelection({ result: "WON", odds: 1.6, fixtureStatus: "FT" }),
        makeSelection({ result: "PENDING", odds: 1.8, fixtureStatus: "LIVE" }),
      ],
    },
    { profile: "STANDARD" },
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, "ok");
});

test("standard profile rejects suspended match", () => {
  const result = evaluateCashoutEligibility(
    {
      status: "OPEN",
      selections: [
        makeSelection({ result: "WON", odds: 2.1, fixtureStatus: "FT" }),
        makeSelection({ result: "PENDING", odds: 1.9, fixtureStatus: "SUSP" }),
      ],
    },
    { profile: "STANDARD" },
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "match_suspended");
});

test("cashier profile requires 30-minute cooldown after last match", () => {
  const now = new Date("2026-04-29T10:20:00.000Z");
  const result = evaluateCashoutEligibility(
    {
      status: "PRINTED",
      selections: [
        makeSelection({
          result: "WON",
          odds: 1.5,
          fixtureStatus: "FT",
          startTime: "2026-04-29T10:00:00.000Z",
        }),
        makeSelection({
          result: "WON",
          odds: 1.7,
          fixtureStatus: "FT",
          startTime: "2026-04-29T10:00:00.000Z",
        }),
        makeSelection({
          result: "WON",
          odds: 1.8,
          fixtureStatus: "FT",
          startTime: "2026-04-29T10:00:00.000Z",
        }),
      ],
    },
    { profile: "CASHIER_OFFLINE", now },
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "cooldown_not_elapsed");
});

test("buildCashoutQuote returns margin breakdown", async () => {
  const fakePrisma = {
    setting: {
      findUnique: async ({ where }) =>
        where.key === "CASHOUT_SYSTEM_MARGIN" ? { value: "0.6" } : null,
    },
  };

  const quote = await buildCashoutQuote(fakePrisma, {
    status: "OPEN",
    cashier_id: null,
    stake: 50,
    selections: [
      makeSelection({ result: "WON", odds: 2.0, fixtureStatus: "FT" }),
      makeSelection({ result: "PENDING", odds: 1.8, fixtureStatus: "LIVE" }),
    ],
  });

  assert.equal(quote.allowed, true);
  assert.equal(quote.amount, 60);
  assert.equal(quote.breakdown.margin, 0.6);
  assert.equal(quote.breakdown.grossOffer, 60);
  assert.equal(quote.breakdown.taxWithheld, 0);
  assert.equal(quote.breakdown.netAmount, 60);
});

test("buildCashoutQuote reduces cashout by snapshotted winnings tax", async () => {
  const fakePrisma = {
    setting: {
      findUnique: async ({ where }) =>
        where.key === "CASHOUT_SYSTEM_MARGIN" ? { value: "0.6" } : null,
    },
  };

  const quote = await buildCashoutQuote(fakePrisma, {
    status: "OPEN",
    cashier_id: null,
    stake: 50,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.2,
    selections: [
      makeSelection({ result: "WON", odds: 2.0, fixtureStatus: "FT" }),
      makeSelection({ result: "PENDING", odds: 1.8, fixtureStatus: "LIVE" }),
    ],
  });

  assert.equal(quote.allowed, true);
  assert.equal(quote.breakdown.grossOffer, 60);
  assert.equal(quote.breakdown.taxWithheld, 12);
  assert.equal(quote.breakdown.netAmount, 48);
  assert.equal(quote.amount, 48);
});
