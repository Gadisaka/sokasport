import { describe, expect, it } from "vitest";
import { formatCouponInput } from "./formatCouponInput.js";

describe("formatCouponInput", () => {
  it("inserts hyphen after the fifth digit", () => {
    expect(formatCouponInput("1234512345")).toBe("12345-12345");
  });

  it("reformats pasted values with an existing hyphen", () => {
    expect(formatCouponInput("12345-12345")).toBe("12345-12345");
  });

  it("keeps partial input unhyphenated until six digits", () => {
    expect(formatCouponInput("12345")).toBe("12345");
    expect(formatCouponInput("123456")).toBe("12345-6");
  });

  it("ignores non-digits and caps at ten digits", () => {
    expect(formatCouponInput("12a34 56-789012345678")).toBe("12345-67890");
  });
});
