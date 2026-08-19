/**
 * Run with: node --test backend/tests/ticketSellReadiness.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productOddsFromSnapshotEntries,
  resolveSelectionIndex,
  selectionIdForTicketLeg,
  evaluateTicketSelectionRemoval,
} from "../lib/ticketSelectionHelpers.js";
import { validateTicketLegCount } from "../lib/betSlipLegLimits.js";

test("resolveSelectionIndex resolves snapshot pseudo ids", () => {
  const ticket = { id: "tk-1", selections: [{ id: "sel-a" }] };
  assert.equal(resolveSelectionIndex(ticket, "snapshot-tk-1-2"), 1);
  assert.equal(resolveSelectionIndex(ticket, "sel-a"), 0);
  assert.equal(resolveSelectionIndex(ticket, "missing"), -1);
});

test("productOddsFromSnapshotEntries multiplies decimal odds", () => {
  const odds = productOddsFromSnapshotEntries([
    { odds: 2 },
    { odds: 1.5 },
  ]);
  assert.equal(odds, 3);
});

test("selectionIdForTicketLeg prefers db selection id", () => {
  const ticket = {
    id: "tk-2",
    selections: [{ id: "real-id" }, {}],
  };
  assert.equal(selectionIdForTicketLeg(ticket, 0), "real-id");
  assert.equal(selectionIdForTicketLeg(ticket, 1), "snapshot-tk-2-2");
});

test("validateTicketLegCount rejects removing last leg", () => {
  assert.equal(validateTicketLegCount(0), "A ticket must have at least 1 match.");
  assert.equal(validateTicketLegCount(1), null);
});

test("removing one leg recomputes total odds and keeps min leg count", () => {
  const snapshot = [{ odds: 2 }, { odds: 3 }, { odds: 1.5 }];
  const next = snapshot.filter((_, i) => i !== 1);
  assert.equal(productOddsFromSnapshotEntries(next), 3);
  assert.equal(validateTicketLegCount(next.length), null);
  assert.match(String(validateTicketLegCount(0)), /at least 1 match/);
});

test("evaluateTicketSelectionRemoval allows dropping an expired leg among 11", () => {
  const selections = Array.from({ length: 11 }, (_, i) => ({
    id: `sel-${i}`,
    odds: 1.2 + i * 0.01,
  }));
  const result = evaluateTicketSelectionRemoval(selections, "sel-0");
  assert.equal(result.ok, true);
  assert.equal(result.remainingSelections.length, 10);
  assert.equal(result.nextTotalOdds, productOddsFromSnapshotEntries(result.remainingSelections));
});

test("evaluateTicketSelectionRemoval does not require remaining legs to be placement-valid", () => {
  const selections = [
    { id: "expired", odds: 1.8 },
    { id: "started-too", odds: 2.1 },
    { id: "ok", odds: 1.5 },
  ];
  const result = evaluateTicketSelectionRemoval(selections, "expired");
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.remainingSelections.map((row) => row.id),
    ["started-too", "ok"],
  );
});

test("evaluateTicketSelectionRemoval rejects the last remaining leg", () => {
  const result = evaluateTicketSelectionRemoval(
    [{ id: "only", odds: 2 }],
    "only",
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.message, /at least one selection/i);
});

test("evaluateTicketSelectionRemoval rejects missing selection", () => {
  const result = evaluateTicketSelectionRemoval(
    [
      { id: "a", odds: 2 },
      { id: "b", odds: 2 },
    ],
    "missing",
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});
