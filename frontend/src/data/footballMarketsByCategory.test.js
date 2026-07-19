import { describe, expect, it } from "vitest";
import {
  filterCategoriesByChipId,
  getTabsForMarketName,
  MARKET_FILTER_ALL_CHIP_ID,
} from "./footballMarketsByCategory.js";

describe("getTabsForMarketName", () => {
  it("maps Double Chance combo markets to combination", () => {
    expect(
      getTabsForMarketName("Double Chance/Total").has("combination"),
    ).toBe(true);
    expect(
      getTabsForMarketName("Double Chance/Both Teams To Score").has(
        "combination",
      ),
    ).toBe(true);
  });

  it("maps Match Winner to main-market", () => {
    expect(getTabsForMarketName("Match Winner").has("main-market")).toBe(true);
  });

  it("maps Fulltime Result alias to main-market via catalog", () => {
    expect(getTabsForMarketName("fulltime result").has("main-market")).toBe(
      true,
    );
  });

  it("maps Goals Over/Under to goals tab", () => {
    expect(getTabsForMarketName("Goals Over/Under").has("goals")).toBe(true);
  });

  it("maps Asian Handicap to main-market and handicaps", () => {
    const tabs = getTabsForMarketName("Asian Handicap");
    expect(tabs.has("main-market")).toBe(true);
    expect(tabs.has("handicaps")).toBe(true);
  });

  it("returns empty set for unknown labels", () => {
    expect(getTabsForMarketName("Completely Unknown Market XYZ").size).toBe(0);
  });
});

describe("filterCategoriesByChipId", () => {
  const cats = [
    { category: "Match Winner", odds: [] },
    { category: "Goals Over/Under", odds: [] },
    { category: "Niche Unknown Prop", odds: [] },
  ];

  it("returns all categories for All chip", () => {
    expect(filterCategoriesByChipId(cats, MARKET_FILTER_ALL_CHIP_ID)).toEqual(
      cats,
    );
  });

  it("filters by tab id", () => {
    expect(filterCategoriesByChipId(cats, "goals")).toEqual([
      { category: "Goals Over/Under", odds: [] },
    ]);
  });

  it("returns empty array for non-all when nothing matches", () => {
    expect(filterCategoriesByChipId(cats, "yellow-cards")).toEqual([]);
  });
});
