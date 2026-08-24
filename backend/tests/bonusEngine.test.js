/**
 * Run: node --test backend/tests/bonusEngine.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAccumulatorPercent,
  computeStackedDepositBonusAmount,
  computeWelcomeFlatAmount,
  computeCashbackAmount,
  evaluateCashback,
  pickCashbackTier,
  potentialWinWithAccumulator,
  roundMoney,
} from "../lib/bonusEngine.js";
import { DEFAULT_CASHBACK_RULES } from "../lib/ensureBonusPresets.js";

const TIERS = [
  { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
  { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
  { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
  { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
  { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
  { minResult: 400, maxResult: null, stakeMultiplier: 10 },
];

function tieredBonus(overrides = {}) {
  return {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: {
      minSelections: 2,
      minStake: 10,
      maxHours: 72,
      minResult: 20,
      tiers: TIERS,
      ...overrides,
    },
  };
}

/** Build N selections, the last one LOST with `lostOdds`, the rest WON. */
function selections(count, lostOdds) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      result: i === count - 1 ? "LOST" : "WON",
      odds: i === count - 1 ? lostOdds : 1.5,
    });
  }
  return out;
}

function profileBonus(overrides = {}) {
  return {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: {
      ...DEFAULT_CASHBACK_RULES,
      ...overrides,
      profiles: overrides.profiles ?? DEFAULT_CASHBACK_RULES.profiles,
    },
  };
}

/**
 * Build `count` legs. The last `lostCount` are LOST.
 * `lostOdds` is a number (repeated) or an array of odds for those lost legs.
 * Remaining won legs use `wonOdds` (default 1.5).
 */
function profileSelections({
  count,
  lostOdds,
  lostCount = 1,
  wonOdds = 1.5,
  liveIndexes = [],
}) {
  const lostList = Array.isArray(lostOdds)
    ? lostOdds
    : Array.from({ length: lostCount }, () => lostOdds);
  const out = [];
  for (let i = 0; i < count; i++) {
    const lostOffset = i - (count - lostList.length);
    const isLost = lostOffset >= 0;
    out.push({
      result: isLost ? "LOST" : "WON",
      odds: isLost ? lostList[lostOffset] : wonOdds,
      live_at_placement: liveIndexes.includes(i),
    });
  }
  return out;
}

test("computeWelcomeFlatAmount uses fixedAmount then percentage as flat", () => {
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 0,
      rules: { fixedAmount: 50 },
    }),
    50,
  );
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 25,
      rules: {},
    }),
    25,
  );
});

test("first deposit stacks as max of FIRST_DEPOSIT and DEPOSIT", () => {
  const first = {
    type: "FIRST_DEPOSIT",
    status: true,
    percentage: 50,
    min_deposit: 0,
  };
  const dep = {
    type: "DEPOSIT",
    status: true,
    percentage: 10,
    min_deposit: 0,
  };
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, true),
    50,
  );
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, false),
    10,
  );
});

test("computeAccumulatorPercent picks highest matching tier", () => {
  const bonus = {
    type: "ACCUMULATOR",
    status: true,
    percentage: 0,
    rules: {
      tiers: [
        { minLegs: 3, bonusPercent: 1 },
        { minLegs: 5, bonusPercent: 5 },
      ],
    },
  };
  assert.equal(computeAccumulatorPercent(bonus, 2), 0);
  assert.equal(computeAccumulatorPercent(bonus, 4), 1);
  assert.equal(computeAccumulatorPercent(bonus, 5), 5);
});

test("potentialWinWithAccumulator", () => {
  assert.equal(potentialWinWithAccumulator(10, 2, 10), roundMoney(10 * 2 * 1.1));
});

test("computeCashbackAmount (legacy flat) respects minTotalOdds", () => {
  const bonus = {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: { minTotalOdds: 2, percentOfStake: 5 },
  };
  const ticket = { user_id: "u1", stake: 100, total_odds: 1.5 };
  assert.equal(computeCashbackAmount(ticket, bonus), 0);
  assert.equal(
    computeCashbackAmount({ user_id: "u1", stake: 100, total_odds: 3 }, bonus),
    5,
  );
});

test("pickCashbackTier matches inclusive ranges and open-ended last tier", () => {
  assert.equal(pickCashbackTier(19.99, TIERS), null);
  assert.equal(pickCashbackTier(20, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(44, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(45, TIERS).stakeMultiplier, 2);
  assert.equal(pickCashbackTier(99, TIERS).stakeMultiplier, 3);
  assert.equal(pickCashbackTier(199, TIERS).stakeMultiplier, 4);
  assert.equal(pickCashbackTier(399, TIERS).stakeMultiplier, 5);
  assert.equal(pickCashbackTier(400, TIERS).stakeMultiplier, 10);
  assert.equal(pickCashbackTier(99999, TIERS).stakeMultiplier, 10);
});

test("evaluateCashback worked example: 96 odds / 2.3 lost = 41.73 -> stake x1", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 10);
});

test("evaluateCashback uses the largest lost-leg odds (conservative)", () => {
  // total 300, two LOST legs (2.0 and 3.0) -> 300/3 = 100 -> x4
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 300, created_at: new Date() },
    selections: [
      { result: "WON", odds: 1.5 },
      { result: "LOST", odds: 2.0 },
      { result: "LOST", odds: 3.0 },
    ],
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.result, 100);
  assert.equal(ev.tier.stakeMultiplier, 4);
  assert.equal(ev.amount, 40);
});

test("evaluateCashback gate: selection count must be greater than minSelections", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(2, 2.3), // minSelections is 2 -> needs > 2
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "too_few_selections");
});

test("evaluateCashback gate: stake below minStake", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 5, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_stake");
});

test("evaluateCashback gate: outside time window", () => {
  const created = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: created },
    selections: selections(3, 2.3),
    bonus: tieredBonus({ maxHours: 72 }),
    now: new Date(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "outside_time_window");
});

test("evaluateCashback gate: any disqualified fixture status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    fixtureStatuses: ["FT", "PST", "FT"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: any disqualified match status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    matchStatuses: ["FINISHED", "SUSPENDED"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: result below minResult", () => {
  // 40 / 2.3 = 17.39 < 20
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 40, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_result");
});

test("computeCashbackAmount uses tiered path when rules.tiers present", () => {
  const amount = computeCashbackAmount(
    { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    tieredBonus(),
    { selections: selections(3, 2.3), now: new Date() },
  );
  assert.equal(amount, 10);
});

test("evaluateCashback allows cashier tickets without user_id", () => {
  const ev = evaluateCashback({
    ticket: {
      user_id: null,
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
    selections: selections(10, 1.63),
    bonus: tieredBonus({ minSelections: 7, minStake: 20 }),
    now: new Date(),
  });
  // 500.99 / 1.63 ≈ 307.36 → 200–399 tier → ×5 → 150
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 5);
  assert.equal(ev.amount, 150);
});

test("pickCashbackTier rounds a between-band ratio down to the band reached", () => {
  // 44.6 sits between the 20-44 and 45-79 bands; ranges are whole numbers but
  // odds ratios are not, so it must pay the 20-44 multiplier, not nothing.
  assert.equal(pickCashbackTier(44.6, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(79.9, TIERS).stakeMultiplier, 2);
  assert.equal(pickCashbackTier(99.5, TIERS).stakeMultiplier, 3);
  assert.equal(pickCashbackTier(399.2, TIERS).stakeMultiplier, 5);
  // Still nothing below the lowest band.
  assert.equal(pickCashbackTier(19.99, TIERS), null);
});

test("evaluateCashback pays a between-band ratio instead of denying it", () => {
  // 103.2372 / 2.3 = 44.886 -> 20-44 band -> stake x1
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 30, total_odds: 103.2372, created_at: new Date() },
    selections: selections(9, 2.3),
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 30);
});

test("evaluateCashback prices tiers off sold odds when a leg voided", () => {
  // Sold at 1.5 * 1.5 * 2.0 * 2.0 = 9 ... scaled up to cross a band boundary.
  const sels = [
    { result: "VOID", odds: 2 },
    { result: "WON", odds: 5 },
    { result: "WON", odds: 5 },
    { result: "LOST", odds: 2 },
  ];
  // Settlement collapsed the VOID leg: stored odds are 5*5*2 = 50 (ratio 25,
  // x1) but the customer bought 2*5*5*2 = 100 (ratio 50, x2).
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 50, created_at: new Date() },
    selections: sels,
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.result, 50);
  assert.equal(ev.tier.stakeMultiplier, 2);
  assert.equal(ev.amount, 20);
});

test("evaluateCashback keeps stored odds when no leg voided", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.ok(ev.result > 41.7 && ev.result < 41.8);
  assert.equal(ev.amount, 10);
});

test("evaluateCashback reported slip: 10 legs, stake 30, 500.99/1.63 → ×5", () => {
  const ev = evaluateCashback({
    ticket: {
      user_id: "u1",
      stake: 30,
      total_odds: 500.99,
      created_at: new Date(),
    },
    selections: selections(10, 1.63),
    bonus: tieredBonus({ minSelections: 7, minStake: 20, maxHours: 72 }),
    now: new Date(),
  });
  assert.ok(ev.result > 307 && ev.result < 308);
  assert.equal(ev.tier.stakeMultiplier, 5);
  assert.equal(ev.amount, 150);
});

test("v3 one-loss: 96 / 2.3 = 41.74 -> stake x2", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    now: new Date(),
    isOnline: true,
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.profileKey, "oneLoss");
  assert.equal(ev.tier.stakeMultiplier, 2);
  assert.equal(ev.amount, 20);
});

test("v3 one-loss tier boundaries 19 / 39 / 40 / 3000+", () => {
  const run = (totalOdds, lostOdds) =>
    evaluateCashback({
      ticket: { user_id: "u1", stake: 10, total_odds: totalOdds, created_at: new Date() },
      selections: profileSelections({ count: 5, lostOdds, wonOdds: 2 }),
      bonus: profileBonus(),
      isOnline: true,
    });
  const at19 = run(38, 2);
  assert.ok(Math.abs(at19.result - 19) < 1e-9);
  assert.equal(at19.tier.stakeMultiplier, 1);
  assert.equal(run(78, 2).tier.stakeMultiplier, 1); // 39
  assert.equal(run(80, 2).tier.stakeMultiplier, 2); // 40
  assert.equal(run(6000, 2).tier.stakeMultiplier, 100); // 3000
  const below = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 37, created_at: new Date() },
    selections: profileSelections({ count: 5, lostOdds: 2, wonOdds: 2 }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(below.eligible, false);
  assert.equal(below.reason, "below_min_result");
});

test("v3 two-loss uses sum of lost-leg odds", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 20, total_odds: 200, created_at: new Date() },
    selections: profileSelections({
      count: 10,
      lostCount: 2,
      lostOdds: [2.0, 3.0],
      wonOdds: 1.5,
    }),
    bonus: profileBonus(),
    isOnline: true,
  });
  // 200 / (2+3) = 40 → 20–45 → ×1
  assert.equal(ev.eligible, true);
  assert.equal(ev.profileKey, "twoLoss");
  assert.equal(ev.result, 40);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 20);
});

test("v3 two-loss tier boundaries 20 / 45 / 46 / gap 60 / 1800+", () => {
  const run = (totalOdds, lostA, lostB) =>
    evaluateCashback({
      ticket: { user_id: "u1", stake: 20, total_odds: totalOdds, created_at: new Date() },
      selections: profileSelections({
        count: 10,
        lostCount: 2,
        lostOdds: [lostA, lostB],
        wonOdds: 1.5,
      }),
      bonus: profileBonus(),
      isOnline: true,
    });
  assert.equal(run(80, 2, 2).tier.stakeMultiplier, 1); // 20
  assert.equal(run(180, 2, 2).tier.stakeMultiplier, 1); // 45
  assert.equal(run(184, 2, 2).tier.stakeMultiplier, 2); // 46
  // 60.4 sits in the 59–61 gap → round down to 46–59
  const gap = run(241.6, 2, 2);
  assert.ok(gap.result > 60 && gap.result < 61);
  assert.equal(gap.tier.stakeMultiplier, 2);
  assert.equal(run(7200, 2, 2).tier.stakeMultiplier, 50); // 1800
});

test("v3 gate: one-loss needs 5+ legs, two-loss needs 10+", () => {
  const oneShort = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: profileSelections({ count: 4, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(oneShort.eligible, false);
  assert.equal(oneShort.reason, "too_few_selections");
  assert.equal(oneShort.profileKey, "oneLoss");

  const oneOk = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(oneOk.eligible, true);

  const twoShort = evaluateCashback({
    ticket: { user_id: "u1", stake: 20, total_odds: 200, created_at: new Date() },
    selections: profileSelections({
      count: 9,
      lostCount: 2,
      lostOdds: [2, 3],
      wonOdds: 1.5,
    }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(twoShort.eligible, false);
  assert.equal(twoShort.reason, "too_few_selections");
  assert.equal(twoShort.profileKey, "twoLoss");
});

test("v3 gate: every leg must be strictly greater than the min odds", () => {
  const oneEq = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.01 }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(oneEq.eligible, false);
  assert.equal(oneEq.reason, "leg_odds_below_min");

  const twoEq = evaluateCashback({
    ticket: { user_id: "u1", stake: 20, total_odds: 200, created_at: new Date() },
    selections: profileSelections({
      count: 10,
      lostCount: 2,
      lostOdds: [2, 3],
      wonOdds: 1.4,
    }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(twoEq.eligible, false);
  assert.equal(twoEq.reason, "leg_odds_below_min");
});

test("v3 gate: online vs offline min stake (1-loss 10 / 20)", () => {
  const ticket9 = {
    user_id: "u1",
    stake: 9,
    total_odds: 96,
    created_at: new Date(),
  };
  const ticket10 = { ...ticket9, stake: 10 };
  const ticket19 = { ...ticket9, stake: 19 };
  const ticket20 = { ...ticket9, stake: 20 };
  const sels = profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 });

  assert.equal(
    evaluateCashback({
      ticket: ticket9,
      selections: sels,
      bonus: profileBonus(),
      isOnline: true,
    }).reason,
    "below_min_stake",
  );
  assert.equal(
    evaluateCashback({
      ticket: ticket10,
      selections: sels,
      bonus: profileBonus(),
      isOnline: true,
    }).eligible,
    true,
  );
  assert.equal(
    evaluateCashback({
      ticket: ticket19,
      selections: sels,
      bonus: profileBonus(),
      isOnline: false,
    }).reason,
    "below_min_stake",
  );
  assert.equal(
    evaluateCashback({
      ticket: ticket20,
      selections: sels,
      bonus: profileBonus(),
      isOnline: false,
    }).eligible,
    true,
  );
});

test("v3 gate: 48-hour window from placement", () => {
  const created = new Date(Date.now() - 49 * 60 * 60 * 1000);
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: created },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    now: new Date(),
    isOnline: true,
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "outside_time_window");

  const justInside = evaluateCashback({
    ticket: {
      user_id: "u1",
      stake: 10,
      total_odds: 96,
      created_at: new Date(Date.now() - 47 * 60 * 60 * 1000),
    },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    now: new Date(),
    isOnline: true,
  });
  assert.equal(justInside.eligible, true);
});

test("v3 gate: live legs block online tickets but not printed slips", () => {
  const ticket = {
    user_id: "u1",
    stake: 10,
    total_odds: 96,
    created_at: new Date(),
  };
  const sels = profileSelections({
    count: 5,
    lostOdds: 2.3,
    wonOdds: 1.5,
    liveIndexes: [0],
  });
  const online = evaluateCashback({
    ticket,
    selections: sels,
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(online.eligible, false);
  assert.equal(online.reason, "live_leg_excluded");

  const printed = evaluateCashback({
    ticket: { ...ticket, user_id: null, stake: 20 },
    selections: sels,
    bonus: profileBonus(),
    isOnline: false,
  });
  assert.equal(printed.eligible, true);

  const channelLive = evaluateCashback({
    ticket: { ...ticket, channel: "LIVE" },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(channelLive.reason, "live_leg_excluded");
});

test("v3 gate: three lost legs is too many", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 20, total_odds: 300, created_at: new Date() },
    selections: profileSelections({
      count: 10,
      lostCount: 3,
      lostOdds: [2, 2, 2],
      wonOdds: 1.5,
    }),
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "too_many_lost_legs");
});

test("v3 gate: postponed fixture still disqualifies", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
    fixtureStatuses: ["FT", "PST", "FT", "FT", "FT"],
    bonus: profileBonus(),
    isOnline: true,
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("computeCashbackAmount uses v3 profiles when present", () => {
  const amount = computeCashbackAmount(
    { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    profileBonus(),
    {
      selections: profileSelections({ count: 5, lostOdds: 2.3, wonOdds: 1.5 }),
      now: new Date(),
      isOnline: true,
    },
  );
  assert.equal(amount, 20);
});
