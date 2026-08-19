import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { removableExpiredSelectionIds } from "./selectionExpiry.js";

const NOW = Date.parse("2026-06-02T12:00:00Z");

function sel(id, kickoffAt) {
  return { id, match: { startTime: kickoffAt } };
}

const FUTURE = "2026-06-02T13:00:00Z";
const PAST = "2026-06-02T11:00:00Z";

describe("removableExpiredSelectionIds", () => {
  it("returns the expired id from an 11-leg ticket", () => {
    const selections = Array.from({ length: 10 }, (_, i) =>
      sel(`ok-${i}`, FUTURE),
    );
    selections.unshift(sel("expired", PAST));
    assert.deepEqual(removableExpiredSelectionIds(selections, NOW), [
      "expired",
    ]);
  });

  it("returns both expired ids when valids remain", () => {
    const selections = [
      sel("expired-a", PAST),
      sel("ok", FUTURE),
      sel("expired-b", PAST),
    ];
    assert.deepEqual(
      new Set(removableExpiredSelectionIds(selections, NOW)),
      new Set(["expired-a", "expired-b"]),
    );
  });

  it("keeps the first when every leg is expired", () => {
    const selections = [
      sel("keep", PAST),
      sel("drop-a", PAST),
      sel("drop-b", PAST),
    ];
    assert.deepEqual(removableExpiredSelectionIds(selections, NOW), [
      "drop-a",
      "drop-b",
    ]);
  });

  it("unions server fixture_started ids when client kickoff is missing", () => {
    const selections = [
      { id: "started", match: { startTime: null } },
      sel("ok", FUTURE),
    ];
    const blockingLegs = [
      { selectionId: "started", code: "fixture_started" },
    ];
    assert.deepEqual(
      removableExpiredSelectionIds(selections, NOW, blockingLegs),
      ["started"],
    );
  });

  it("does not auto-remove locked legs", () => {
    const selections = [
      { id: "locked", match: { startTime: FUTURE } },
      sel("ok", FUTURE),
    ];
    const blockingLegs = [{ selectionId: "locked", code: "market_locked" }];
    assert.deepEqual(
      removableExpiredSelectionIds(selections, NOW, blockingLegs),
      [],
    );
  });

  it("returns empty when only one selection remains", () => {
    assert.deepEqual(removableExpiredSelectionIds([sel("only", PAST)], NOW), []);
  });
});
