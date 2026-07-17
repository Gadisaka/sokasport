import { test } from "node:test";
import assert from "node:assert/strict";

// fixturesListService pulls Config/db.js which requires DATABASE_URL at import.
process.env.DATABASE_URL ||=
  "mongodb://127.0.0.1:27017/fixtures-list-odd-lines-test";

const {
  dedupeOddLinesByValue,
  FIXTURES_BY_DATE_CACHE_VERSION,
} = await import("../services/fixturesListService.js");

test("FIXTURES_BY_DATE_CACHE_VERSION bumped for summary odd-line semantics", () => {
  assert.equal(FIXTURES_BY_DATE_CACHE_VERSION, "v8");
});

test("dedupeOddLinesByValue keeps Home when multi-bookmaker Away/Draw duplicates exist", () => {
  const fixture = {
    markets: [
      {
        name: "Match Winner",
        odd_lines: [
          { id: "a1", value: "Away", odd: 6.5, bookmaker_id: "bk-old" },
          { id: "a2", value: "Away", odd: 6.9, bookmaker_id: "bk-pref" },
          { id: "d1", value: "Draw", odd: 5.0, bookmaker_id: "bk-old" },
          { id: "d2", value: "Draw", odd: 5.3, bookmaker_id: "bk-pref" },
          { id: "h1", value: "Home", odd: 1.4, bookmaker_id: "bk-old" },
          { id: "h2", value: "Home", odd: 1.45, bookmaker_id: "bk-pref" },
        ],
      },
    ],
  };

  dedupeOddLinesByValue(fixture, "bk-pref");
  const values = fixture.markets[0].odd_lines.map((l) => l.value).sort();
  assert.deepEqual(values, ["Away", "Draw", "Home"]);
  assert.equal(
    fixture.markets[0].odd_lines.find((l) => l.value === "Home")?.odd,
    1.45,
  );
});

test("dedupeOddLinesByValue retains Home/Draw when Draw/Away is duplicated", () => {
  const fixture = {
    markets: [
      {
        name: "Double Chance",
        odd_lines: [
          { id: "x2a", value: "Draw/Away", odd: 2.7, bookmaker_id: "bk-old" },
          { id: "x2b", value: "Draw/Away", odd: 2.9, bookmaker_id: "bk-pref" },
          { id: "12a", value: "Home/Away", odd: 1.15, bookmaker_id: "bk-old" },
          { id: "12b", value: "Home/Away", odd: 1.17, bookmaker_id: "bk-pref" },
          { id: "1xa", value: "Home/Draw", odd: 1.11, bookmaker_id: "bk-old" },
          { id: "1xb", value: "Home/Draw", odd: 1.08, bookmaker_id: "bk-pref" },
        ],
      },
    ],
  };

  dedupeOddLinesByValue(fixture, "bk-pref");
  const byValue = Object.fromEntries(
    fixture.markets[0].odd_lines.map((l) => [l.value, l]),
  );
  assert.ok(byValue["Home/Draw"], "1X (Home/Draw) must be retained");
  assert.equal(byValue["Home/Draw"].odd, 1.08);
  assert.equal(byValue["Draw/Away"].bookmaker_id, "bk-pref");
  assert.equal(byValue["Home/Away"].bookmaker_id, "bk-pref");
});

test("dedupeOddLinesByValue prefers preferred bookmaker on duplicate value", () => {
  const fixture = {
    markets: [
      {
        name: "Match Winner",
        odd_lines: [
          { id: "h-old", value: "Home", odd: 2.0, bookmaker_id: "bk-old" },
          { id: "h-pref", value: "Home", odd: 1.9, bookmaker_id: "bk-pref" },
        ],
      },
    ],
  };

  dedupeOddLinesByValue(fixture, "bk-pref");
  assert.equal(fixture.markets[0].odd_lines.length, 1);
  assert.equal(fixture.markets[0].odd_lines[0].id, "h-pref");
  assert.equal(fixture.markets[0].odd_lines[0].odd, 1.9);
});

test("dedupeOddLinesByValue keeps first when preferred is unset", () => {
  const fixture = {
    markets: [
      {
        name: "Match Winner",
        odd_lines: [
          { id: "h1", value: "Home", odd: 2.0, bookmaker_id: "bk-a" },
          { id: "h2", value: "Home", odd: 1.9, bookmaker_id: "bk-b" },
        ],
      },
    ],
  };

  dedupeOddLinesByValue(fixture, null);
  assert.equal(fixture.markets[0].odd_lines.length, 1);
  assert.equal(fixture.markets[0].odd_lines[0].id, "h1");
});
