import assert from "node:assert/strict";
import test from "node:test";
import { countUniquePricedSelections } from "../services/lib/pricedOddsCount.js";

test("countUniquePricedSelections counts unique market × value cells", () => {
  const n = countUniquePricedSelections([
    { market_id: "m1", value: "1", odd: 2.1 },
    { market_id: "m1", value: "X", odd: 3.2 },
    { market_id: "m1", value: "2", odd: 4.0 },
    { market_id: "m2", value: "Over 2.5", odd: 1.9 },
    { market_id: "m2", value: "Under 2.5", odd: 1.85 },
  ]);
  assert.equal(n, 5);
});

test("countUniquePricedSelections dedupes same label across bookmakers", () => {
  const n = countUniquePricedSelections([
    { market_id: "m1", value: "1", odd: 2.1 },
    { market_id: "m1", value: "1", odd: 2.05 },
    { market_id: "m1", value: "Home", odd: 2.0 },
  ]);
  // "1" and "Home" are distinct raw labels (normalization is UI-side)
  assert.equal(n, 2);
});

test("countUniquePricedSelections ignores invalid odds and empty values", () => {
  const n = countUniquePricedSelections([
    { market_id: "m1", value: "1", odd: 2.1 },
    { market_id: "m1", value: "X", odd: 0 },
    { market_id: "m1", value: "2", odd: NaN },
    { market_id: "m1", value: " ", odd: 1.5 },
    { market_id: null, value: "1", odd: 1.5 },
    { value: "1", odd: 1.5 },
  ]);
  assert.equal(n, 1);
});

test("countUniquePricedSelections is case-insensitive on value", () => {
  const n = countUniquePricedSelections([
    { market_id: "m1", value: "Over 2.5", odd: 1.9 },
    { market_id: "m1", value: "over 2.5", odd: 1.91 },
  ]);
  assert.equal(n, 1);
});
