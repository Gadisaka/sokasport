import { describe, expect, it } from "vitest";
import { getTopLeagueOrder } from "./topLeagues.js";

describe("getTopLeagueOrder", () => {
  it("pins Ethiopian PL before England and the big five", () => {
    const eth = getTopLeagueOrder("Ethiopia - Premier League");
    const epl = getTopLeagueOrder("England - Premier League");
    const laliga = getTopLeagueOrder("Spain - La Liga");
    expect(eth).toBeLessThan(epl);
    expect(epl).toBeLessThan(laliga);
  });

  it("places domestic cups after their country's top division", () => {
    const epl = getTopLeagueOrder("England - Premier League");
    const fa = getTopLeagueOrder("England - FA Cup");
    const laliga = getTopLeagueOrder("Spain - La Liga");
    const copa = getTopLeagueOrder("Spain - Copa del Rey");
    expect(fa).toBeGreaterThan(epl);
    expect(copa).toBeGreaterThan(laliga);
  });

  it("returns null for leagues outside the top pin list", () => {
    expect(getTopLeagueOrder("Norway - Eliteserien")).toBeNull();
  });
});
