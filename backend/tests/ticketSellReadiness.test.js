/**
 * Run with: node --test backend/tests/ticketSellReadiness.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productOddsFromSnapshotEntries,
  resolveSelectionIndex,
  selectionIdForTicketLeg,
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
