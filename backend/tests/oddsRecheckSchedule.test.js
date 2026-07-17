import assert from "node:assert/strict";
import test from "node:test";
import { nextOddsRecheckDelayMs } from "../Config/ingestionConfig.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("nextOddsRecheckDelayMs uses 15m within 24h of kickoff", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  const kickoff = new Date(now + 6 * HOUR);
  assert.equal(nextOddsRecheckDelayMs(kickoff, now), 15 * MINUTE);
});

test("nextOddsRecheckDelayMs uses 1h for 1–3 day horizon", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  const kickoff = new Date(now + 2 * DAY);
  assert.equal(nextOddsRecheckDelayMs(kickoff, now), 1 * HOUR);
});

test("nextOddsRecheckDelayMs uses 4h for 3–7 day horizon", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  const kickoff = new Date(now + 5 * DAY);
  assert.equal(nextOddsRecheckDelayMs(kickoff, now), 4 * HOUR);
});

test("nextOddsRecheckDelayMs uses 12h for 7–14 day horizon", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  const kickoff = new Date(now + 10 * DAY);
  assert.equal(nextOddsRecheckDelayMs(kickoff, now), 12 * HOUR);
});
