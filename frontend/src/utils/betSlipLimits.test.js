import { describe, expect, it } from "vitest";
import {
  MAX_SLIP_SELECTIONS,
  clampSelectionsToMax,
  toggleSlipSelection,
} from "./betSlipLimits.js";

describe("betSlipLimits", () => {
  it("blocks adding a 21st distinct match", () => {
    const current = Array.from({ length: MAX_SLIP_SELECTIONS }, (_, i) => ({
      id: `sel-${i}`,
      matchName: `Team A${i} V Team B${i}`,
    }));
    const result = toggleSlipSelection(current, {
      id: "new",
      matchName: "Team X V Team Y",
    });
    expect(result.blocked).toBe(true);
    expect(result.next).toHaveLength(MAX_SLIP_SELECTIONS);
  });

  it("clamps loaded selections to the max", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `x-${i}`,
      matchName: `M${i} V N${i}`,
    }));
    expect(clampSelectionsToMax(rows)).toHaveLength(MAX_SLIP_SELECTIONS);
  });
});
