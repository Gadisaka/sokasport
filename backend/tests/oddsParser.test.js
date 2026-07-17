import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkets } from "../utils/oddsParser.js";

function mkPayload(preferredHasNoLines) {
  return [
    {
      fixture: { id: 1 },
      bookmakers: [
        {
          id: 8,
          name: "Eight",
          bets: [
            {
              name: "Match Winner",
              values: preferredHasNoLines
                ? []
                : [{ value: "Away", odd: "3.00" }],
            },
          ],
        },
        {
          id: 11,
          name: "Eleven",
          bets: [
            {
              name: "Match Winner",
              values: [{ value: "Home", odd: "2.10" }],
            },
          ],
        },
      ],
    },
  ];
}

test("parseMarkets picks first ordered bookmaker with non-empty markets", () => {
  const parsed = parseMarkets(mkPayload(true), {
    orderedBookmakerApiIds: [8, 11],
    allowedMarketNames: null,
  });
  assert.equal(parsed.bookmakers.length, 1);
  assert.equal(parsed.bookmakers[0].apiBookmakerId, 11);
  assert.ok(parsed.bookmakers[0].markets.length > 0);
});

test("parseMarkets fallthrough picks first non-chain bookmaker with prices", () => {
  const payload = [
    {
      fixture: { id: 1 },
      bookmakers: [
        {
          id: 8,
          name: "Preferred",
          bets: [{ name: "Match Winner", values: [] }],
        },
        {
          id: 11,
          name: "Chain",
          bets: [{ name: "Match Winner", values: [] }],
        },
        {
          id: 47,
          name: "Other",
          bets: [
            {
              name: "Match Winner",
              values: [{ value: "Home", odd: "1.90" }],
            },
          ],
        },
      ],
    },
  ];
  const parsed = parseMarkets(payload, {
    orderedBookmakerApiIds: [8, 11],
    anyBookmakerFallthrough: true,
    allowedMarketNames: null,
  });
  assert.equal(parsed.bookmakers.length, 1);
  assert.equal(parsed.bookmakers[0].apiBookmakerId, 47);
});

test("parseMarkets without fallthrough returns empty when chain empty", () => {
  const payload = [
    {
      fixture: { id: 1 },
      bookmakers: [
        {
          id: 8,
          name: "Preferred",
          bets: [{ name: "Match Winner", values: [] }],
        },
        {
          id: 47,
          name: "Other",
          bets: [
            {
              name: "Match Winner",
              values: [{ value: "Home", odd: "1.90" }],
            },
          ],
        },
      ],
    },
  ];
  const parsed = parseMarkets(payload, {
    orderedBookmakerApiIds: [8],
    anyBookmakerFallthrough: false,
    allowedMarketNames: null,
  });
  assert.equal(parsed.bookmakers.length, 0);
});

test("parseMarkets legacy mode keeps multiple bookmakers when filter unset", () => {
  const parsed = parseMarkets(mkPayload(false), {
    orderedBookmakerApiIds: null,
    allowedBookmakerApiIds: null,
    allowedMarketNames: null,
  });
  assert.equal(parsed.bookmakers.length, 2);
});
