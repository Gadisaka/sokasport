import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOverrideKey,
  gradeSelectionWithOverride,
  buildOverridePayloadFromInput,
} from "../lib/fixtureMarketOverrides.js";

describe("fixtureMarketOverrides", () => {
  it("buildOverrideKey is stable for param key order", () => {
    const a = buildOverrideKey("OVER_UNDER", { line: 2.5, side: "over" });
    const b = buildOverrideKey("OVER_UNDER", { side: "over", line: 2.5 });
    assert.equal(a, b);
  });

  it("grades WON when selection matches override winner", () => {
    const payload = buildOverridePayloadFromInput({
      "MATCH_WINNER::{}": {
        marketCode: "MATCH_WINNER",
        marketParams: {},
        winningSelections: ["Home"],
      },
    });
    const out = gradeSelectionWithOverride(
      {
        market_code: "MATCH_WINNER",
        market_params: {},
        selection: "Home",
      },
      payload,
    );
    assert.equal(out?.result, "WON");
    assert.equal(out?.reason, "admin_market_override");
  });

  it("grades LOST when selection does not match", () => {
    const payload = buildOverridePayloadFromInput({
      "MATCH_WINNER::{}": {
        marketCode: "MATCH_WINNER",
        winningSelections: ["Home"],
      },
    });
    const out = gradeSelectionWithOverride(
      {
        market_code: "MATCH_WINNER",
        selection: "Away",
      },
      payload,
    );
    assert.equal(out?.result, "LOST");
  });

  it("returns null without market_code", () => {
    assert.equal(
      gradeSelectionWithOverride({ selection: "Home" }, { markets: {} }),
      null,
    );
  });
});
