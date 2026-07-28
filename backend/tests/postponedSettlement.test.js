import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  POSTPONED_WAIT_HOURS,
  evaluatePostponedSettlementWait,
  getPostponedWaitInfo,
  resolvePostponedAtOnSync,
} from "../lib/postponedSettlement.js";

describe("postponedSettlement", () => {
  it("resolvePostponedAtOnSync sets timestamp when status becomes PST", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const ts = resolvePostponedAtOnSync(
      { status: "NS" },
      { status: "PST" },
      now,
    );
    assert.equal(ts?.toISOString(), now.toISOString());
  });

  it("resolvePostponedAtOnSync preserves timestamp while staying PST", () => {
    const existingAt = new Date("2026-06-01T10:00:00Z");
    const ts = resolvePostponedAtOnSync(
      { status: "PST", postponed_at: existingAt },
      { status: "PST" },
    );
    assert.equal(ts?.toISOString(), existingAt.toISOString());
  });

  it("resolvePostponedAtOnSync clears timestamp when rescheduled from PST", () => {
    const ts = resolvePostponedAtOnSync(
      { status: "PST", postponed_at: new Date() },
      { status: "NS" },
    );
    assert.equal(ts, null);
  });

  it("evaluatePostponedSettlementWait blocks settlement within 72 hours", () => {
    const now = new Date("2026-06-04T00:00:00Z");
    const postponedAt = new Date("2026-06-03T00:00:00Z");
    const result = evaluatePostponedSettlementWait(
      { status: "PST", postponed_at: postponedAt },
      {},
      now,
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "postponed_wait_pending");
    assert.equal(result.waitHoursRemaining, 48);
  });

  it("evaluatePostponedSettlementWait allows settlement after 72 hours", () => {
    const now = new Date("2026-06-06T01:00:00Z");
    const postponedAt = new Date("2026-06-01T00:00:00Z");
    const result = evaluatePostponedSettlementWait(
      { status: "PST", postponed_at: postponedAt },
      {},
      now,
    );
    assert.equal(result.ok, true);
  });

  it("evaluatePostponedSettlementWait bypasses wait when force is true", () => {
    const now = new Date("2026-06-01T01:00:00Z");
    const postponedAt = new Date("2026-06-01T00:00:00Z");
    const result = evaluatePostponedSettlementWait(
      { status: "PST", postponed_at: postponedAt },
      { force: true },
      now,
    );
    assert.equal(result.ok, true);
  });

  it("evaluatePostponedSettlementWait allows immediate void when postponed_at is missing", () => {
    const result = evaluatePostponedSettlementWait({ status: "PST" }, {});
    assert.equal(result.ok, true);
  });

  it("getPostponedWaitInfo returns countdown for PST fixtures", () => {
    const now = new Date("2026-06-02T00:00:00Z");
    const postponedAt = new Date("2026-06-01T00:00:00Z");
    const info = getPostponedWaitInfo(
      { status: "PST", postponed_at: postponedAt },
      now,
    );
    assert.equal(info.waitHoursRemaining, POSTPONED_WAIT_HOURS - 24);
    assert.equal(
      info.postponedWaitExpires?.toISOString(),
      new Date("2026-06-04T00:00:00Z").toISOString(),
    );
  });
});
