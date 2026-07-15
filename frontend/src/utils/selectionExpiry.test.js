import { describe, expect, it } from "vitest";
import {
  isSelectionExpired,
  pruneExpiredFromSlips,
  pruneExpiredFromSlipsWithCount,
  pruneExpiredSelections,
} from "./selectionExpiry.js";

const NOW = Date.parse("2026-06-02T12:00:00Z");

describe("isSelectionExpired", () => {
  it("expires prematch after kickoff", () => {
    expect(
      isSelectionExpired({ kickoffAt: "2026-06-02T11:00:00Z" }, NOW),
    ).toBe(true);
    expect(
      isSelectionExpired({ kickoffAt: "2026-06-02T13:00:00Z" }, NOW),
    ).toBe(false);
  });

  it("expires terminal status even for live rows", () => {
    expect(
      isSelectionExpired({ fromLive: true, matchStatus: "FT" }, NOW),
    ).toBe(true);
  });

  it("does not expire live rows at kickoff alone", () => {
    expect(
      isSelectionExpired(
        { fromLive: true, kickoffAt: "2026-06-02T11:00:00Z" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("pruneExpiredSelections", () => {
  it("returns same reference for empty / unchanged", () => {
    const empty = [];
    expect(pruneExpiredSelections(empty, NOW)).toBe(empty);

    const ok = [{ id: "a", kickoffAt: "2026-06-02T13:00:00Z" }];
    expect(pruneExpiredSelections(ok, NOW)).toBe(ok);
  });

  it("removes expired and keeps valid", () => {
    const keep = { id: "keep", kickoffAt: "2026-06-02T13:00:00Z" };
    const drop = { id: "drop", kickoffAt: "2026-06-02T11:00:00Z" };
    const live = {
      id: "live",
      fromLive: true,
      kickoffAt: "2026-06-02T11:00:00Z",
    };
    const finished = { id: "ft", matchStatus: "FT" };
    const next = pruneExpiredSelections([keep, drop, live, finished], NOW);
    expect(next).toEqual([keep, live]);
  });

  it("may empty the list", () => {
    expect(
      pruneExpiredSelections(
        [{ id: "a", kickoffAt: "2026-06-02T10:00:00Z" }],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("pruneExpiredFromSlips", () => {
  it("returns same slips object when nothing expired", () => {
    const slips = {
      betslip1: [{ id: "a", kickoffAt: "2026-06-02T13:00:00Z" }],
      betslip2: [],
      betslip3: [],
    };
    expect(pruneExpiredFromSlips(slips, NOW)).toBe(slips);
  });

  it("prunes across tabs and reports count", () => {
    const slips = {
      betslip1: [
        { id: "a", kickoffAt: "2026-06-02T13:00:00Z" },
        { id: "b", kickoffAt: "2026-06-02T10:00:00Z" },
      ],
      betslip2: [{ id: "c", matchStatus: "FT" }],
      betslip3: [],
    };
    const { slips: next, removedCount } = pruneExpiredFromSlipsWithCount(
      slips,
      NOW,
    );
    expect(removedCount).toBe(2);
    expect(next.betslip1).toEqual([
      { id: "a", kickoffAt: "2026-06-02T13:00:00Z" },
    ]);
    expect(next.betslip2).toEqual([]);
    expect(next.betslip3).toEqual([]);
  });
});
