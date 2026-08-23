import { describe, expect, it } from "vitest";
import {
  formatOutcomeAmount,
  resolveTicketCheckOutcome,
} from "./ticketCheckOutcome.js";

describe("resolveTicketCheckOutcome", () => {
  it("prefers explicit API outcome and amount", () => {
    expect(
      resolveTicketCheckOutcome({
        outcome: "bonus",
        outcomeAmount: 50,
        status: "LOST",
        netPayout: 0,
      }),
    ).toEqual({ outcome: "bonus", amount: 50 });
  });

  it("falls back to won + netPayout when outcome is omitted", () => {
    expect(
      resolveTicketCheckOutcome({ status: "WON", netPayout: 850 }),
    ).toEqual({ outcome: "won", amount: 850 });
    expect(
      resolveTicketCheckOutcome({ status: "PAID", netPayout: 200 }),
    ).toEqual({ outcome: "won", amount: 200 });
  });

  it("falls back to lost for LOST without cashback fields", () => {
    expect(resolveTicketCheckOutcome({ status: "LOST" })).toEqual({
      outcome: "lost",
      amount: null,
    });
  });

  it("falls back to bonus for CASHBACK_PAID", () => {
    expect(
      resolveTicketCheckOutcome({
        status: "CASHBACK_PAID",
        outcomeAmount: 40,
      }),
    ).toEqual({ outcome: "bonus", amount: 40 });
  });

  it("treats open / printed / held as pending", () => {
    for (const status of ["OPEN", "PRINTED", "HELD"]) {
      expect(resolveTicketCheckOutcome({ status })).toEqual({
        outcome: "pending",
        amount: null,
      });
    }
  });

  it("maps void and cancelled statuses", () => {
    expect(resolveTicketCheckOutcome({ status: "VOID" })).toEqual({
      outcome: "void",
      amount: null,
    });
    expect(resolveTicketCheckOutcome({ status: "CANCELED" })).toEqual({
      outcome: "cancelled",
      amount: null,
    });
    expect(resolveTicketCheckOutcome({ status: "CASHED_OUT" })).toEqual({
      outcome: "cancelled",
      amount: null,
    });
  });
});

describe("formatOutcomeAmount", () => {
  it("formats a finite amount in ETB", () => {
    expect(formatOutcomeAmount(1250)).toBe("1,250.00 ETB");
    expect(formatOutcomeAmount(50.5)).toBe("50.50 ETB");
  });

  it("returns null for missing amounts", () => {
    expect(formatOutcomeAmount(null)).toBe(null);
    expect(formatOutcomeAmount(undefined)).toBe(null);
    expect(formatOutcomeAmount("")).toBe(null);
  });
});
