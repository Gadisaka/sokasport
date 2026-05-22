import Decimal from "decimal.js";

Decimal.set({
  precision: 32,
  rounding: Decimal.ROUND_HALF_UP,
});

export function d(value) {
  return new Decimal(value ?? 0);
}

export function toMoney(value, scale = 2) {
  return Number(d(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString());
}

export function mul(...values) {
  return values.reduce((acc, val) => acc.mul(d(val)), d(1));
}

export function add(...values) {
  return values.reduce((acc, val) => acc.add(d(val)), d(0));
}

export function sub(a, b) {
  return d(a).sub(d(b));
}

