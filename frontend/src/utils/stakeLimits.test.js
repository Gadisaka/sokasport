import { describe, expect, it } from "vitest";
import {
  capGrossPotentialWin,
  clampStakeToLimits,
  clampStakeToUpperBound,
  coerceStakeDisplayToLimits,
  depositAmountViolation,
  stakeAndPotentialWinViolation,
  stakeLimitsHintParts,
  withdrawAmountViolation,
} from "./stakeLimits.js";

/** Matches typical admin betting & financial limits (ETB). */
const SAMPLE_FINANCIAL = {
  MIN_BET_AMOUNT: 50,
  MAX_BET_AMOUNT: 1000,
  MAX_WINNING_AMOUNT: 100_000,
  MIN_DEPOSIT: 60,
  MAX_DEPOSIT: 50_000,
  MIN_WITHDRAW: 500,
  MAX_WITHDRAW: 10_000,
};

describe("stake limits (financial settings)", () => {
  describe("coerceStakeDisplayToLimits / clampStakeToLimits", () => {
    it("raises legacy default stake 20 ETB when min bet is higher", () => {
      expect(
        coerceStakeDisplayToLimits("20", SAMPLE_FINANCIAL),
      ).toBe("50");
      expect(clampStakeToLimits(SAMPLE_FINANCIAL, 20)).toBe(50);
    });

    it("caps stake above configured max bet", () => {
      expect(
        coerceStakeDisplayToLimits("5000", SAMPLE_FINANCIAL),
      ).toBe("1000");
      expect(clampStakeToLimits(SAMPLE_FINANCIAL, 5000)).toBe(1000);
    });

    it("does not coerce empty stake so user may clear input", () => {
      expect(coerceStakeDisplayToLimits("", SAMPLE_FINANCIAL)).toBe("");
    });
  });

  describe("clampStakeToUpperBound", () => {
    it("does not raise values below MIN_BET_AMOUNT", () => {
      expect(clampStakeToUpperBound(SAMPLE_FINANCIAL, 20)).toBe(20);
      expect(clampStakeToUpperBound(SAMPLE_FINANCIAL, 0)).toBe(0);
    });

    it("caps at MAX_BET_AMOUNT and floors negatives to 0", () => {
      expect(clampStakeToUpperBound(SAMPLE_FINANCIAL, 5000)).toBe(1000);
      expect(clampStakeToUpperBound(SAMPLE_FINANCIAL, -5)).toBe(0);
    });

    it("with no max limit, only enforces non-negative", () => {
      const noMax = { MIN_BET_AMOUNT: 10 };
      expect(clampStakeToUpperBound(noMax, 5)).toBe(5);
      expect(clampStakeToUpperBound(noMax, -1)).toBe(0);
    });
  });

  describe("stakeAndPotentialWinViolation", () => {
    it("blocks stake below MIN_BET_AMOUNT", () => {
      expect(
        stakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 20, 600),
      ).toContain("Minimum stake is 50");
    });

    it("allows MIN_BET stake with potential win inside cap", () => {
      expect(
        stakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 50, 4500),
      ).toBeNull();
    });

    it("blocks stake above MAX_BET_AMOUNT", () => {
      expect(
        stakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 2000, 5000),
      ).toContain("Maximum stake is 1000");
    });

    it("allows any gross potential win at stake limits (capping is separate)", () => {
      expect(
        stakeAndPotentialWinViolation(SAMPLE_FINANCIAL, 1000, 100_005),
      ).toBeNull();
    });
  });

  describe("capGrossPotentialWin", () => {
    it("clamps gross win to MAX_WINNING_AMOUNT", () => {
      expect(capGrossPotentialWin(SAMPLE_FINANCIAL, 100_005)).toBe(100_000);
      expect(capGrossPotentialWin(SAMPLE_FINANCIAL, 50_000)).toBe(50_000);
    });

    it("passes through when max win is unset", () => {
      const noMax = { ...SAMPLE_FINANCIAL, MAX_WINNING_AMOUNT: null };
      expect(capGrossPotentialWin(noMax, 100_005)).toBe(100_005);
    });
  });

  describe("withdrawAmountViolation", () => {
    it("enforces MIN_WITHDRAW and MAX_WITHDRAW", () => {
      expect(withdrawAmountViolation(SAMPLE_FINANCIAL, 400)).toContain(
        "Minimum withdrawal is 500",
      );
      expect(withdrawAmountViolation(SAMPLE_FINANCIAL, 99_999)).toContain(
        "Maximum withdrawal is 10000",
      );
      expect(withdrawAmountViolation(SAMPLE_FINANCIAL, 750)).toBeNull();
    });
  });

  describe("depositAmountViolation", () => {
    it("enforces MIN_DEPOSIT and MAX_DEPOSIT", () => {
      expect(depositAmountViolation(SAMPLE_FINANCIAL, 10)).toContain(
        "Minimum deposit is 60",
      );
      expect(depositAmountViolation(SAMPLE_FINANCIAL, 99_999)).toContain(
        "Maximum deposit is 50000",
      );
      expect(depositAmountViolation(SAMPLE_FINANCIAL, 5000)).toBeNull();
    });
  });

  describe("stakeLimitsHintParts", () => {
    it("includes min/max stake and max win when configured", () => {
      const parts = stakeLimitsHintParts(SAMPLE_FINANCIAL);
      expect(parts.join(" · ")).toContain("Min stake 50");
      expect(parts.join(" · ")).toContain("Max stake 1000");
      expect(parts.join(" · ")).toContain("100000");
    });
  });
});
