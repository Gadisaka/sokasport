import { describe, expect, it } from "vitest";
import { resolveCompactMarketToken } from "./compactMarketToken.js";

describe("resolveCompactMarketToken", () => {
  it("maps 1/x/2 to Match Winner sides", () => {
    expect(resolveCompactMarketToken("1")).toEqual({
      marketLabel: "Match Winner",
      marketCode: "MATCH_WINNER",
      marketParams: { side: "HOME" },
      label: "1",
    });
    expect(resolveCompactMarketToken("x")).toEqual({
      marketLabel: "Match Winner",
      marketCode: "MATCH_WINNER",
      marketParams: { side: "DRAW" },
      label: "X",
    });
    expect(resolveCompactMarketToken("2")).toEqual({
      marketLabel: "Match Winner",
      marketCode: "MATCH_WINNER",
      marketParams: { side: "AWAY" },
      label: "2",
    });
  });

  it("maps 1x/x2/12 to Double Chance combinations", () => {
    expect(resolveCompactMarketToken("1x")).toEqual({
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination: "1X" },
      label: "1X",
    });
    expect(resolveCompactMarketToken("x2")).toEqual({
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination: "X2" },
      label: "X2",
    });
    expect(resolveCompactMarketToken("12")).toEqual({
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination: "12" },
      label: "12",
    });
  });

  it("is case-insensitive on the token id", () => {
    expect(resolveCompactMarketToken("X2")).toEqual({
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination: "X2" },
      label: "X2",
    });
  });

  it("returns null for unknown tokens", () => {
    expect(resolveCompactMarketToken("over")).toBeNull();
    expect(resolveCompactMarketToken("")).toBeNull();
    expect(resolveCompactMarketToken(null)).toBeNull();
    expect(resolveCompactMarketToken(undefined)).toBeNull();
  });
});
