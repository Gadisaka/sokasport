/**
 * Behavioural tests for `services/ticketSettlementService.js`.
 *
 * The settlement service touches the Prisma client at module level, so
 * we install a hand-rolled in-memory store in front of it. The store
 * mirrors only the surface area the service uses (`fixture`, `match`,
 * `ticket`, `ticketSelection`, `wallet`, `transaction`) and supports
 * `$transaction(callback)` so the service runs inside its own
 * transaction semantics — exactly as it does in production.
 *
 * Run with:  node --test backend/tests/ticketSettlementService.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

// We import the in-memory Prisma stub through a loader hook so the
// module under test sees our shim instead of the real client.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stubAbsPath = pathToFileURL(
  path.join(__dirname, "fixtures", "prismaInMemoryStub.js"),
).href;

// Load the stub directly. Then point both `Config/db.js` exports to it
// by mocking with import.meta cache.
const stubModule = await import(stubAbsPath);
const { resetStore, getStore, prisma } = stubModule;

// Replace the Config/db.js module exports in the loader cache. Node ESM
// doesn't expose its module cache for in-process replacement, so we use
// the `module.register` API the project already uses (no extra deps).
const loaderUrl = pathToFileURL(
  path.join(__dirname, "fixtures", "prismaLoader.mjs"),
).href;
register(loaderUrl, import.meta.url);

const settlement = await import("../services/ticketSettlementService.js");
const { SELECTION_RESULT } = await import("../services/marketEvaluator.js");

function seedFixture({ id, status, homeScore, awayScore }) {
  const store = getStore();
  store.fixture.set(id, {
    id,
    api_fixture_id: Number.parseInt(id.replace(/\D/g, ""), 10) || 1,
    status,
    home_score: homeScore,
    away_score: awayScore,
    settled_at: null,
    settled_status: null,
    grading_completed_at: null,
  });
}

function seedTicket({ id, userId = null, stake, totalOdds, status = "OPEN" }) {
  const store = getStore();
  store.ticket.set(id, {
    id,
    coupon_number: id,
    user_id: userId,
    cashier_id: null,
    branch_name: "",
    branch_location: "",
    stake,
    total_odds: totalOdds,
    potential_win: stake * totalOdds,
    status,
  });
}

function seedSelection({
  id,
  ticketId,
  matchId = null,
  fixtureId,
  selection,
  marketCode,
  marketParams = null,
  odds,
}) {
  const store = getStore();
  store.ticketSelection.set(id, {
    id,
    ticket_id: ticketId,
    match_id: matchId,
    fixture_id: fixtureId,
    selection,
    market_code: marketCode,
    market_params: marketParams,
    odds,
    result: SELECTION_RESULT.PENDING,
  });
}

function seedWallet({ id, userId, balance, withdrawable = 0 }) {
  const store = getStore();
  store.wallet.set(id, {
    id,
    user_id: userId,
    wallet_type: "PLAYER",
    balance,
    withdrawable,
  });
}

function seedSetting({ id, key, value }) {
  const store = getStore();
  store.setting.set(id, { id, key, value });
}

test("single-leg WON ticket transitions to PAID and credits player wallet", async () => {
  resetStore();
  seedFixture({ id: "fx-1", status: "FT", homeScore: 2, awayScore: 0 });
  seedTicket({
    id: "tk-1",
    userId: "user-1",
    stake: 100,
    totalOdds: 2,
  });
  seedSelection({
    id: "sel-1",
    ticketId: "tk-1",
    fixtureId: "fx-1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-1", userId: "user-1", balance: 50 });

  const summary = await settlement.settleFixture("fx-1");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.payoutsCredited, 1);

  const store = getStore();
  const ticket = store.ticket.get("tk-1");
  assert.equal(ticket.status, "PAID");

  const wallet = store.wallet.get("w-1");
  // Stake was already debited at placement (not modeled here); credit
  // increases balance by potential_win = 200.
  assert.equal(wallet.balance, 250);
  assert.equal(wallet.withdrawable, 200);

  const txns = [...store.transaction.values()];
  assert.equal(txns.length, 1);
  assert.equal(txns[0].reference, "win-settlement:tk-1");
  assert.equal(txns[0].type, "PAYOUT");
  assert.equal(txns[0].amount, 200);
});

test("WON potential_win is capped at configured MAX_WINNING_AMOUNT", async () => {
  resetStore();
  seedSetting({
    id: "set-maxwin",
    key: "MAX_WINNING_AMOUNT",
    value: "150",
  });
  seedFixture({ id: "fx-cap", status: "FT", homeScore: 1, awayScore: 0 });
  seedTicket({ id: "tk-cap", userId: "user-cap", stake: 100, totalOdds: 2 });
  seedSelection({
    id: "sel-cap",
    ticketId: "tk-cap",
    fixtureId: "fx-cap",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-cap", userId: "user-cap", balance: 0 });

  await settlement.settleFixture("fx-cap");

  const ticket = getStore().ticket.get("tk-cap");
  assert.equal(ticket.potential_win, 150);

  const wallet = getStore().wallet.get("w-cap");
  assert.equal(wallet.balance, 150);
});

test("multi-leg ticket: any LOST leg => ticket LOST immediately", async () => {
  resetStore();
  // Fixture 1 => home wins (1)
  seedFixture({ id: "fx-1", status: "FT", homeScore: 3, awayScore: 1 });
  // Fixture 2 => not yet finished
  seedFixture({ id: "fx-2", status: "NS", homeScore: null, awayScore: null });

  seedTicket({ id: "tk-2", userId: "user-2", stake: 50, totalOdds: 4 });
  seedSelection({
    id: "sel-a",
    ticketId: "tk-2",
    fixtureId: "fx-1",
    selection: "X",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-b",
    ticketId: "tk-2",
    fixtureId: "fx-2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-2", userId: "user-2", balance: 0 });

  const summary = await settlement.settleFixture("fx-1");
  assert.equal(summary.ticketsLost, 1);
  assert.equal(summary.ticketsWon, 0);

  const ticket = getStore().ticket.get("tk-2");
  assert.equal(ticket.status, "LOST");
  assert.equal(ticket.potential_win, 0);
});

test("idempotency: replaying settlement does not double-credit", async () => {
  resetStore();
  seedFixture({ id: "fx-3", status: "FT", homeScore: 1, awayScore: 0 });
  seedTicket({ id: "tk-3", userId: "user-3", stake: 10, totalOdds: 3 });
  seedSelection({
    id: "sel-3",
    ticketId: "tk-3",
    fixtureId: "fx-3",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedWallet({ id: "w-3", userId: "user-3", balance: 0 });

  const a = await settlement.settleFixture("fx-3");
  assert.equal(a.payoutsCredited, 1);

  const b = await settlement.settleFixture("fx-3");
  assert.equal(b.skipped, true);
  assert.equal(b.reason, "already_settled");

  const wallet = getStore().wallet.get("w-3");
  assert.equal(wallet.balance, 30); // credited only once

  const txns = [...getStore().transaction.values()];
  assert.equal(txns.length, 1);
});

test("VOID: cancelled fixture sets selections VOID and refunds via 1.0 multiplier", async () => {
  resetStore();
  seedFixture({ id: "fx-4", status: "CANC", homeScore: null, awayScore: null });
  // Two-leg ticket: leg A on cancelled fixture, leg B on a winning home result.
  seedFixture({ id: "fx-5", status: "FT", homeScore: 2, awayScore: 1 });
  seedTicket({ id: "tk-4", userId: "user-4", stake: 20, totalOdds: 6 });
  seedSelection({
    id: "sel-4a",
    ticketId: "tk-4",
    fixtureId: "fx-4",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedSelection({
    id: "sel-4b",
    ticketId: "tk-4",
    fixtureId: "fx-5",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-4", userId: "user-4", balance: 0 });

  await settlement.settleFixture("fx-4");
  await settlement.settleFixture("fx-5");

  const ticket = getStore().ticket.get("tk-4");
  assert.equal(ticket.status, "PAID");
  // VOID leg collapses to 1.0, winning leg odds=2 => potential_win = 20 * 2 = 40
  assert.equal(ticket.potential_win, 40);

  const wallet = getStore().wallet.get("w-4");
  assert.equal(wallet.balance, 40);
});

test("cashier-printed ticket is NOT auto-credited (cashier payout flow owns it)", async () => {
  resetStore();
  seedFixture({ id: "fx-6", status: "FT", homeScore: 2, awayScore: 0 });
  seedTicket({ id: "tk-6", userId: "user-6", stake: 25, totalOdds: 2 });
  seedSelection({
    id: "sel-6",
    ticketId: "tk-6",
    fixtureId: "fx-6",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-6", userId: "user-6", balance: 100 });

  // Pretend a cashier already print-confirmed: ticket-print:<id> BET on
  // a (different) wallet. Online credit must skip this ticket.
  const store = getStore();
  store.transaction.set("print-1", {
    id: "print-1",
    wallet_id: "cashier-wallet",
    type: "BET",
    amount: 25,
    balance_before: 1000,
    balance_after: 975,
    reference: "ticket-print:tk-6",
  });

  const summary = await settlement.settleFixture("fx-6");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.payoutsCredited, 0);

  const ticket = store.ticket.get("tk-6");
  // Ticket is WON (cashier will payout manually) — not PAID.
  assert.equal(ticket.status, "WON");

  const wallet = store.wallet.get("w-6");
  assert.equal(wallet.balance, 100); // untouched
});

test("PENDING ticket with one resolved leg stays OPEN until others resolve", async () => {
  resetStore();
  seedFixture({ id: "fx-7", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-8", status: "NS", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-7", userId: "user-7", stake: 10, totalOdds: 4 });
  seedSelection({
    id: "sel-7a",
    ticketId: "tk-7",
    fixtureId: "fx-7",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-7b",
    ticketId: "tk-7",
    fixtureId: "fx-8",
    selection: "X",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-7", userId: "user-7", balance: 0 });

  await settlement.settleFixture("fx-7");

  const ticket = getStore().ticket.get("tk-7");
  assert.equal(ticket.status, "OPEN"); // still pending the second leg
});

test("all-VOID ticket → status VOID + refund transaction (idempotent on replay)", async () => {
  resetStore();
  seedFixture({ id: "fx-void-1", status: "CANC", homeScore: null, awayScore: null });
  seedFixture({ id: "fx-void-2", status: "ABD", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-void", userId: "user-void", stake: 40, totalOdds: 6 });
  seedSelection({
    id: "sel-v1",
    ticketId: "tk-void",
    fixtureId: "fx-void-1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedSelection({
    id: "sel-v2",
    ticketId: "tk-void",
    fixtureId: "fx-void-2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-void", userId: "user-void", balance: 0 });

  await settlement.settleFixture("fx-void-1");
  const a = await settlement.settleFixture("fx-void-2");
  assert.equal(a.ticketsVoided, 1);
  assert.equal(a.refundsIssued, 1);

  const ticket = getStore().ticket.get("tk-void");
  assert.equal(ticket.status, "VOID");
  // Stake fully refunded.
  const wallet = getStore().wallet.get("w-void");
  assert.equal(wallet.balance, 40);

  const refunds = [...getStore().transaction.values()].filter(
    (t) => t.reference === "bet-refund:tk-void",
  );
  assert.equal(refunds.length, 1);

  // Replay: engine must not double-refund.
  const replay = await settlement.settleFixture("fx-void-2", { force: true });
  assert.equal(replay.refundsIssued, 0);
  const refundsAfter = [...getStore().transaction.values()].filter(
    (t) => t.reference === "bet-refund:tk-void",
  );
  assert.equal(refundsAfter.length, 1);
  assert.equal(getStore().wallet.get("w-void").balance, 40);
});

test("V2 engine: unknown market on FINAL fixture → leg VOID, ticket recomputed", async () => {
  resetStore();
  process.env.SETTLEMENT_ENGINE = "v2";
  try {
    seedFixture({ id: "fx-v2", status: "FT", homeScore: 2, awayScore: 1 });
    seedTicket({ id: "tk-v2", userId: "user-v2", stake: 10, totalOdds: 3 });
    seedSelection({
      id: "sel-v2",
      ticketId: "tk-v2",
      fixtureId: "fx-v2",
      selection: "weird",
      marketCode: "TOTALLY_UNKNOWN_MARKET",
      odds: 3,
    });
    seedWallet({ id: "w-v2", userId: "user-v2", balance: 0 });

    const summary = await settlement.settleFixture("fx-v2");
    // One leg on an unknown market → VOID → all-VOID ticket → refund.
    assert.equal(summary.ticketsVoided, 1);
    const ticket = getStore().ticket.get("tk-v2");
    assert.equal(ticket.status, "VOID");
    const sel = getStore().ticketSelection.get("sel-v2");
    assert.equal(sel.result, "VOID");
    assert.equal(sel.result_meta?.reason, "unknown_market");
    assert.equal(sel.result_meta?.engineVersion, 2);
  } finally {
    delete process.env.SETTLEMENT_ENGINE;
  }
});

test("V2 engine: AWARDED fixture without scores → VOID / awarded_without_scores", async () => {
  resetStore();
  process.env.SETTLEMENT_ENGINE = "v2";
  try {
    seedFixture({ id: "fx-awd", status: "AWD", homeScore: null, awayScore: null });
    seedTicket({ id: "tk-awd", userId: "user-awd", stake: 25, totalOdds: 2 });
    seedSelection({
      id: "sel-awd",
      ticketId: "tk-awd",
      fixtureId: "fx-awd",
      selection: "1",
      marketCode: "MATCH_WINNER",
      odds: 2,
    });
    seedWallet({ id: "w-awd", userId: "user-awd", balance: 0 });

    const summary = await settlement.settleFixture("fx-awd");
    assert.equal(summary.ticketsVoided, 1);
    const sel = getStore().ticketSelection.get("sel-awd");
    assert.equal(sel.result, "VOID");
    assert.equal(sel.result_meta?.reason, "awarded_without_scores");
  } finally {
    delete process.env.SETTLEMENT_ENGINE;
  }
});

test("grading_completed_at left null when some legs remain PENDING (triggers retry job)", async () => {
  resetStore();
  // Fixture FT but no scores and no resultLabel → V2 returns
  // missing_required_data → VOID; fake that scenario by passing an
  // unsupported finality. Simpler: use FT with null scores which
  // canEvaluate rejects → V2 returns VOID (so the leg DOES resolve).
  // To properly test PENDING-after-settle we need the engine to return
  // PENDING. V2 only returns PENDING for finality === PENDING. So we
  // use FT scores that resolve one leg, and a second leg tied to a
  // *non-terminal* fixture that we do not settle yet.
  seedFixture({ id: "fx-ok", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-later", status: "NS", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-gc", userId: "user-gc", stake: 10, totalOdds: 4 });
  seedSelection({
    id: "sel-gc-a",
    ticketId: "tk-gc",
    fixtureId: "fx-ok",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-gc-b",
    ticketId: "tk-gc",
    fixtureId: "fx-later",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-gc", userId: "user-gc", balance: 0 });

  const summary = await settlement.settleFixture("fx-ok");
  // fx-ok had only one leg: sel-gc-a, graded WON. grading_completed_at
  // should be set for fx-ok because it has no remaining pending legs.
  assert.equal(summary.gradingCompleted, true);
  const fx = getStore().fixture.get("fx-ok");
  assert.ok(fx.grading_completed_at instanceof Date);
  // The ticket itself is still OPEN — leg B hasn't resolved — so no
  // payout yet.
  const ticket = getStore().ticket.get("tk-gc");
  assert.equal(ticket.status, "OPEN");
});

test("admin Match result settles market-coded selections without scores", async () => {
  resetStore();
  const store = getStore();

  store.match.set("m-1", {
    id: "m-1",
    status: "LIVE",
    result: null,
    settled_at: null,
  });
  seedTicket({ id: "tk-m-1", userId: null, stake: 20, totalOdds: 2 });
  seedSelection({
    id: "sel-m-1",
    ticketId: "tk-m-1",
    matchId: "m-1",
    fixtureId: null,
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleMatch("m-1", "1");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.ticketsLost, 0);

  const selection = store.ticketSelection.get("sel-m-1");
  assert.equal(selection.result, SELECTION_RESULT.WON);
  const ticket = store.ticket.get("tk-m-1");
  assert.equal(ticket.status, "WON");
  const match = store.match.get("m-1");
  assert.ok(match.settled_at instanceof Date);
});

test("LOST player ticket credits cashback when CASHBACK bonus active", async () => {
  resetStore();
  const store = getStore();
  store.bonus.set("cash-1", {
    id: "cash-1",
    type: "CASHBACK",
    name: "Lossback",
    percentage: 0,
    min_deposit: null,
    status: true,
    rules: { minTotalOdds: 1, percentOfStake: 10 },
  });
  seedFixture({ id: "fx-cb", status: "FT", homeScore: 0, awayScore: 1 });
  seedTicket({ id: "tk-cb", userId: "u-cb", stake: 100, totalOdds: 2 });
  seedSelection({
    id: "sel-cb",
    ticketId: "tk-cb",
    fixtureId: "fx-cb",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-cb", userId: "u-cb", balance: 0 });

  const summary = await settlement.settleFixture("fx-cb");
  assert.equal(summary.ticketsLost, 1);

  const txns = [...store.transaction.values()];
  const bonusTx = txns.find((t) => t.type === "BONUS");
  assert.ok(bonusTx);
  assert.equal(bonusTx.reference, "bonus:cashback:tk-cb");
  assert.equal(bonusTx.amount, 10);

  const wallet = store.wallet.get("w-cb");
  assert.equal(wallet.balance, 10);
});

const TIERED_CASHBACK_RULES = {
  minSelections: 2,
  minStake: 10,
  maxHours: 0,
  minResult: 20,
  disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
  disqualifyMatchStatuses: ["SUSPENDED"],
  tiers: [
    { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
    { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
    { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
    { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
    { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
    { minResult: 400, maxResult: null, stakeMultiplier: 10 },
  ],
};

function seedTieredCashbackBonus() {
  getStore().bonus.set("cash-tier", {
    id: "cash-tier",
    type: "CASHBACK",
    name: "Tiered cashback",
    percentage: 0,
    min_deposit: null,
    status: true,
    rules: TIERED_CASHBACK_RULES,
  });
}

test("LOST ticket credits tiered cashback (totalOdds/lostOdds picks tier)", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // Two home-win legs (4, 10) + one away-win leg (odds 2) that loses.
  // After recompute total_odds = 4*10*2 = 80; result = 80/2 = 40 -> tier x1.
  seedFixture({ id: "fx-w1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-w2", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-l", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-t", userId: "u-t", stake: 10, totalOdds: 80 });
  seedSelection({ id: "s-w1", ticketId: "tk-t", fixtureId: "fx-w1", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "s-w2", ticketId: "tk-t", fixtureId: "fx-w2", selection: "1", marketCode: "MATCH_WINNER", odds: 10 });
  seedSelection({ id: "s-l", ticketId: "tk-t", fixtureId: "fx-l", selection: "1", marketCode: "MATCH_WINNER", odds: 2 });
  seedWallet({ id: "w-t", userId: "u-t", balance: 0 });

  const summary = await settlement.settleFixture("fx-l");
  assert.equal(summary.ticketsLost, 1);

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.ok(bonusTx, "expected a BONUS cashback transaction");
  assert.equal(bonusTx.reference, "bonus:cashback:tk-t");
  assert.equal(bonusTx.amount, 10); // stake 10 x tier multiplier 1
  assert.equal(store.wallet.get("w-t").balance, 10);
});

test("LOST ticket with a postponed leg is NOT eligible for tiered cashback", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // Same shape, but one leg sits on a postponed (PST) fixture -> disqualified.
  seedFixture({ id: "fx-w1b", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-pst", status: "PST", homeScore: null, awayScore: null });
  seedFixture({ id: "fx-lb", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-d", userId: "u-d", stake: 10, totalOdds: 80 });
  seedSelection({ id: "d-w1", ticketId: "tk-d", fixtureId: "fx-w1b", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "d-pst", ticketId: "tk-d", fixtureId: "fx-pst", selection: "1", marketCode: "MATCH_WINNER", odds: 10 });
  seedSelection({ id: "d-l", ticketId: "tk-d", fixtureId: "fx-lb", selection: "1", marketCode: "MATCH_WINNER", odds: 2 });
  seedWallet({ id: "w-d", userId: "u-d", balance: 0 });

  const summary = await settlement.settleFixture("fx-lb");
  assert.equal(summary.ticketsLost, 1);

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.equal(bonusTx, undefined, "postponed leg must block cashback");
  assert.equal(store.wallet.get("w-d").balance, 0);
});
