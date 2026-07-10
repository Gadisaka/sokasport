import assert from "node:assert/strict";
import test from "node:test";
import { buildOddsParseOptions } from "../Config/oddsFilters.js";

test("buildOddsParseOptions adds default fallback chain when preferred set and env chain empty", () => {
  const prev = process.env.BOOKMAKER_FALLBACK_CHAIN;
  const prevDefault = process.env.DEFAULT_BOOKMAKER_API_ID;
  delete process.env.BOOKMAKER_FALLBACK_CHAIN;
  delete process.env.DEFAULT_BOOKMAKER_API_ID;

  try {
    const opts = buildOddsParseOptions(8);
    assert.equal(opts.legacyPersistAllBookmakers, false);
    assert.deepEqual(opts.orderedBookmakerApiIds?.slice(0, 4), [8, 2, 11, 16]);
    assert.ok(opts.orderedBookmakerApiIds.length > 4);
  } finally {
    if (prev === undefined) delete process.env.BOOKMAKER_FALLBACK_CHAIN;
    else process.env.BOOKMAKER_FALLBACK_CHAIN = prev;
    if (prevDefault === undefined) delete process.env.DEFAULT_BOOKMAKER_API_ID;
    else process.env.DEFAULT_BOOKMAKER_API_ID = prevDefault;
  }
});

test("buildOddsParseOptions keeps legacy all-bookmakers when no preferred", () => {
  const opts = buildOddsParseOptions(null);
  assert.equal(opts.legacyPersistAllBookmakers, true);
  assert.equal(opts.orderedBookmakerApiIds, null);
});
