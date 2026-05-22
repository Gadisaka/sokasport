import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWinningsTaxBreakdown,
  ticketWinningsTaxBreakdown,
} from "../lib/winningsTax.js";

test("computeWinningsTaxBreakdown applies rate to gross", () => {
  const { taxAmount, netPayout } = computeWinningsTaxBreakdown(100, true, 0.15);
  assert.equal(taxAmount, 15);
  assert.equal(netPayout, 85);
});

test("computeWinningsTaxBreakdown skips when apply false", () => {
  const { taxAmount, netPayout } = computeWinningsTaxBreakdown(100, false, 0.15);
  assert.equal(taxAmount, 0);
  assert.equal(netPayout, 100);
});

test("ticketWinningsTaxBreakdown reads ticket snapshot flags", () => {
  const b = ticketWinningsTaxBreakdown({
    potential_win: 200,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.1,
  });
  assert.equal(b.taxAmount, 20);
  assert.equal(b.netPayout, 180);
});
