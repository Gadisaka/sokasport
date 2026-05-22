import test from "node:test";
import assert from "node:assert/strict";
import { toMoney, mul, add, sub } from "../lib/moneyDecimal.js";

test("toMoney rounds half up to two decimals", () => {
  assert.equal(toMoney(10.005), 10.01);
  assert.equal(toMoney(10.004), 10);
});

test("mul handles long accumulator chains without float drift", () => {
  const out = mul(100, 1.13, 1.07, 1.11, 1.19, 1.03);
  assert.equal(Number(out.toFixed(2)), 164.5);
});

test("add/sub keep money-safe arithmetic boundaries", () => {
  const out = sub(add(100.1, 0.2), 100.3);
  assert.equal(toMoney(out), 0);
});

