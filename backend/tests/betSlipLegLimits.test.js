import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TICKET_LEGS,
  MIN_TICKET_LEGS,
  validateTicketLegCount,
} from "../lib/betSlipLegLimits.js";

test("validateTicketLegCount accepts 1 through 20 legs", () => {
  assert.equal(validateTicketLegCount(MIN_TICKET_LEGS), null);
  assert.equal(validateTicketLegCount(MAX_TICKET_LEGS), null);
  assert.equal(validateTicketLegCount(10), null);
});

test("validateTicketLegCount rejects empty and over-max slips", () => {
  assert.match(validateTicketLegCount(0), /at least/i);
  assert.match(validateTicketLegCount(21), /cannot have more than 20/i);
});
