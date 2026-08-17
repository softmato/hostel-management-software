import { describe, expect, it } from "vitest";

import { dateForDay, mealTypeNow, todayInNepal } from "@/lib/food-week";

describe("todayInNepal", () => {
  it("is already tomorrow in the UTC evening", () => {
    // 2026-08-16 is a Sunday. 18:30Z is 00:15 Monday in Kathmandu — the exact
    // window when someone opens the app to check dinner.
    expect(todayInNepal(new Date("2026-08-16T18:30:00.000Z"))).toBe("MONDAY");
    expect(todayInNepal(new Date("2026-08-16T18:00:00.000Z"))).toBe("SUNDAY");
  });

  it("reads the same day for a mid-afternoon instant", () => {
    expect(todayInNepal(new Date("2026-08-19T06:00:00.000Z"))).toBe("WEDNESDAY");
  });
});

describe("dateForDay", () => {
  const wednesday = new Date("2026-08-19T06:00:00.000Z");

  it("returns today for today", () => {
    expect(dateForDay("WEDNESDAY", wednesday)).toBe("2026-08-19T00:00:00.000Z");
  });

  it("walks back to earlier days in the same week", () => {
    // Sunday is the week start, so Sunday is three days behind Wednesday.
    expect(dateForDay("SUNDAY", wednesday)).toBe("2026-08-16T00:00:00.000Z");
  });

  it("walks forward to later days in the same week", () => {
    expect(dateForDay("SATURDAY", wednesday)).toBe("2026-08-22T00:00:00.000Z");
  });

  it("crosses a month boundary without landing on day 0", () => {
    // Tuesday 2026-09-01 at 06:00Z; Sunday of that week is 2026-08-30.
    const tuesday = new Date("2026-09-01T06:00:00.000Z");

    expect(dateForDay("SUNDAY", tuesday)).toBe("2026-08-30T00:00:00.000Z");
  });

  it("uses the Nepali day, not the UTC one", () => {
    // 2026-08-19T18:30Z is Thursday in Kathmandu, so "this week's Thursday" is
    // the 20th — not the 13th it would be if the UTC day were used.
    expect(dateForDay("THURSDAY", new Date("2026-08-19T18:30:00.000Z"))).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });
});

describe("mealTypeNow", () => {
  it("buckets by the Kathmandu hour", () => {
    // 02:15Z → 08:00 NPT, 06:15Z → 12:00, 11:15Z → 17:00, 14:15Z → 20:00.
    expect(mealTypeNow(new Date("2026-08-16T02:15:00.000Z"))).toBe("BREAKFAST");
    expect(mealTypeNow(new Date("2026-08-16T06:15:00.000Z"))).toBe("LUNCH");
    expect(mealTypeNow(new Date("2026-08-16T11:15:00.000Z"))).toBe("SNACKS");
    expect(mealTypeNow(new Date("2026-08-16T14:15:00.000Z"))).toBe("DINNER");
  });
});
