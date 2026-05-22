import { describe, expect, it } from "vitest";
import { applyOddsToMatch, mapFixtureToMatch } from "./fixtureMapper.js";

describe("mapFixtureToMatch summary strip", () => {
  const baseFx = () => ({
    api_fixture_id: 1378214,
    start_time: new Date("2026-05-09T14:00:00.000Z").toISOString(),
    status: "NS",
    home_team: { name: "Cagliari", logo: null },
    away_team: { name: "Udinese", logo: null },
    league: { name: "Serie A", country: "Italy", sport: "Football" },
  });

  it("uses first duplicate Double Chance label like expanded panel", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      markets: [
        {
          name: "Double Chance",
          odd_lines: [
            { value: "Home or Draw", odd: 1.4 },
            { value: "Home or Draw", odd: 1.28 },
            { value: "Draw/Away", odd: 1.5 },
            { value: "Home/Away", odd: 1.36 },
          ],
        },
      ],
    });

    const byId = Object.fromEntries(
      match.markets.map(({ id, value }) => [id, value]),
    );
    expect(byId["1x"]).toBe("1.40");
    expect(byId.x2).toBe("1.50");
    expect(byId["12"]).toBe("1.36");
  });

  it("compact main-market Double Chance agrees with detailedOdds first-wins", () => {
    const fixture = {
      ...baseFx(),
      markets: [
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 1.4 },
            { value: "1X", odd: 1.28 },
            { value: "X2", odd: 1.5 },
            { value: "12", odd: 1.36 },
          ],
        },
      ],
    };

    const match = mapFixtureToMatch(fixture);
    const dcDetailed = match.detailedOdds.main.find(
      (m) => m.category === "Double Chance",
    );
    expect(dcDetailed?.odds).toBeDefined();

    const fromStrip = Object.fromEntries(
      match.markets.map(({ id, value }) => [id, value]),
    );
    for (const row of dcDetailed.odds) {
      const lid = row.id.toLowerCase();
      if (["1x", "x2", "12"].includes(lid)) {
        expect(fromStrip[lid]).toBe(row.value);
      }
    }
  });

  it("applyOddsToMatch keeps list strip; detail drives expanded markets only", () => {
    const fixture = {
      ...baseFx(),
      markets: [
        {
          name: "Match Winner",
          odd_lines: [
            { value: "1", odd: 9.99 },
            { value: "Draw", odd: 8.88 },
            { value: "2", odd: 7.77 },
          ],
        },
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 6.66 },
            { value: "X2", odd: 5.55 },
            { value: "12", odd: 4.44 },
          ],
        },
      ],
    };

    const listMatch = mapFixtureToMatch(fixture);

    const detailOddsPayload = {
      markets: [
        ...fixture.markets.map((m) =>
          m.name === "Double Chance"
            ? {
                ...m,
                odd_lines: [
                  { value: "1X", odd: 1.11 },
                  { value: "X2", odd: 2.22 },
                  { value: "12", odd: 3.33 },
                ],
              }
            : m,
        ),
        {
          name: "Goals Over/Under",
          odd_lines: [{ value: "Over 2.5", odd: 1.9 }],
        },
      ],
    };

    const merged = applyOddsToMatch(listMatch, detailOddsPayload);

    expect(merged.markets).toEqual(listMatch.markets);

    const dcMain = merged.detailedOdds.main.find(
      (x) => x.category === "Double Chance",
    );
    const dc1x = dcMain?.odds?.find((o) => String(o.id).toLowerCase() === "1x");
    expect(dc1x?.value).toBe("1.11");

    expect(merged.sideBets).not.toEqual(listMatch.sideBets);
  });

  it("uses extra_markets_count from list API when full markets are not included", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      extra_markets_count: 98,
      markets: [
        {
          name: "Match Winner",
          odd_lines: [
            { value: "1", odd: 2.1 },
            { value: "Draw", odd: 3.2 },
            { value: "2", odd: 4.3 },
          ],
        },
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 1.4 },
            { value: "X2", odd: 1.5 },
            { value: "12", odd: 1.6 },
          ],
        },
      ],
    });

    expect(match.sideBets).toBe(98);
    expect(match.detailedOdds.extra).toHaveLength(0);
  });
});
