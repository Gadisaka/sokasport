import { describe, expect, it } from "vitest";
import { classifyLegStatus } from "./legResultStatus.js";

const NOW = Date.parse("2026-06-02T12:00:00Z");

describe("classifyLegStatus", () => {
  it("maps settled results regardless of status", () => {
    expect(classifyLegStatus({ result: "WON", status: "FT" }, NOW)).toBe("won");
    expect(classifyLegStatus({ result: "LOST", status: "FT" }, NOW)).toBe(
      "lost",
    );
    expect(classifyLegStatus({ result: "VOID", status: "PST" }, NOW)).toBe(
      "postponed",
    );
  });

  it("treats not-started matches as not played", () => {
    expect(classifyLegStatus({ result: "PENDING", status: "NS" }, NOW)).toBe(
      "notplayed",
    );
    expect(
      classifyLegStatus({ result: "PENDING", status: "NOT_STARTED" }, NOW),
    ).toBe("notplayed");
    expect(classifyLegStatus({ result: "PENDING", status: "TBD" }, NOW)).toBe(
      "notplayed",
    );
    expect(classifyLegStatus({ result: "PENDING", status: null }, NOW)).toBe(
      "notplayed",
    );
  });

  it("treats in-progress matches as not finished (postponed bucket)", () => {
    for (const status of ["LIVE", "HT", "1H", "2H", "ET", "SUSP", "SUSPENDED"]) {
      expect(classifyLegStatus({ result: "PENDING", status }, NOW)).toBe(
        "postponed",
      );
    }
  });

  it("treats postponed / cancelled / abandoned as postponed", () => {
    for (const status of ["PST", "CANC", "ABD"]) {
      expect(classifyLegStatus({ result: "PENDING", status }, NOW)).toBe(
        "postponed",
      );
    }
  });

  it("treats finished-but-not-yet-graded as postponed (settlement lag)", () => {
    expect(classifyLegStatus({ result: "PENDING", status: "FT" }, NOW)).toBe(
      "postponed",
    );
    expect(
      classifyLegStatus({ result: "PENDING", status: "FINISHED" }, NOW),
    ).toBe("postponed");
  });

  it("treats a not-started status with a past kickoff as postponed (sync lag)", () => {
    expect(
      classifyLegStatus(
        {
          result: "PENDING",
          status: "NS",
          kickoffAt: "2026-06-02T10:00:00Z",
        },
        NOW,
      ),
    ).toBe("postponed");
    // Future kickoff stays not-played.
    expect(
      classifyLegStatus(
        {
          result: "PENDING",
          status: "NS",
          kickoffAt: "2026-06-02T14:00:00Z",
        },
        NOW,
      ),
    ).toBe("notplayed");
  });

  it("degrades unknown status to not played", () => {
    expect(classifyLegStatus({ result: "PENDING", status: "ZZZ" }, NOW)).toBe(
      "notplayed",
    );
  });

  it("defaults missing result to PENDING", () => {
    expect(classifyLegStatus({ status: "NS" }, NOW)).toBe("notplayed");
    expect(classifyLegStatus({ status: "LIVE" }, NOW)).toBe("postponed");
  });
});
