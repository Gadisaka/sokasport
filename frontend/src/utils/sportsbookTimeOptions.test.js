import { describe, expect, it } from "vitest";
import {
  MOBILE_PICKER_MIN_OFFSET,
  MOBILE_QUICK_DAY_COUNT,
  buildMobileCalendarGroups,
  dayOffsetFromLocalYmd,
  localYmdForDayOffset,
} from "./sportsbookTimeOptions.js";

describe("buildMobileCalendarGroups", () => {
  const timeOptions = Array.from({ length: 14 }, (_, off) => ({
    id: off === 0 ? "today" : off === 1 ? "tomorrow" : `day${off}`,
    label: `d${off}`,
  }));

  it("puts quick chips on first days and all later days in the dropdown", () => {
    const groups = buildMobileCalendarGroups(timeOptions, { horizonDays: 14 });
    expect(groups.quickTabs).toHaveLength(MOBILE_QUICK_DAY_COUNT);
    expect(groups.quickTabs[0].id).toBe("today");
    expect(groups.quickTabs[3].id).toBe("day3");
    expect(groups.pickerDays.map((d) => d.offset)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(groups.pickerDays[0].offset).toBe(MOBILE_PICKER_MIN_OFFSET);
    expect(groups.listedTabs).toHaveLength(0);
  });
});

describe("localYmdForDayOffset", () => {
  it("round-trips with dayOffsetFromLocalYmd", () => {
    const now = new Date(2026, 5, 1);
    const ymd = localYmdForDayOffset(5, now);
    expect(dayOffsetFromLocalYmd(ymd, now)).toBe(5);
  });
});
