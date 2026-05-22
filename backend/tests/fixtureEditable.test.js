import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isFixtureEditable,
  startOfTodayUtc,
  getFixtureEditableReason,
} from "../lib/fixtureEditable.js";

describe("fixtureEditable", () => {
  const now = new Date("2026-05-21T12:00:00Z");

  it("past NS before today is not editable by default", () => {
    const fixture = { start_time: new Date("2026-05-20T18:00:00Z"), status: "NS" };
    assert.equal(isFixtureEditable(fixture, { now }), false);
    assert.equal(getFixtureEditableReason(fixture, { now }), "not_editable");
  });

  it("past NS is editable when includeIncompletePast", () => {
    const fixture = { start_time: new Date("2026-05-20T18:00:00Z"), status: "NS" };
    assert.equal(
      isFixtureEditable(fixture, { now, includeIncompletePast: true }),
      true,
    );
    assert.equal(
      getFixtureEditableReason(fixture, { now, includeIncompletePast: true }),
      "incomplete_past",
    );
  });

  it("past LIVE is editable", () => {
    const fixture = { start_time: new Date("2026-05-20T18:00:00Z"), status: "LIVE" };
    assert.equal(isFixtureEditable(fixture, { now }), true);
    assert.equal(getFixtureEditableReason(fixture, { now }), "past_in_progress");
  });

  it("terminal today is editable", () => {
    const fixture = { start_time: new Date("2026-05-21T10:00:00Z"), status: "FT" };
    assert.equal(isFixtureEditable(fixture, { now }), true);
    assert.equal(getFixtureEditableReason(fixture, { now }), "terminal");
  });

  it("today upcoming live is not editable", () => {
    const fixture = { start_time: new Date("2026-05-21T18:00:00Z"), status: "LIVE" };
    assert.equal(isFixtureEditable(fixture, { now }), false);
  });

  it("startOfTodayUtc is midnight UTC", () => {
    const s = startOfTodayUtc(now);
    assert.equal(s.toISOString(), "2026-05-21T00:00:00.000Z");
  });
});
