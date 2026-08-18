import { describe, expect, it } from "vitest";

import {
  coveredMealCount,
  groupPhotosByDay,
  hostelDayKey,
} from "@/modules/food/food-photo-days";

/**
 * The failure these exist for is off-by-one-day, which only shows up for the
 * early and late meals and only for a country whose offset is not a whole hour.
 * So the cases are pinned to real Nepal wall-clock times rather than to tidy
 * midnights.
 */

function photo(date: string, uploadedAt = date, mealType = "DINNER") {
  return { date: new Date(date), mealType, uploadedAt: new Date(uploadedAt) };
}

describe("hostelDayKey", () => {
  it("uses the Nepal day, not the UTC one, for an early meal", () => {
    // 05:30 on the 18th in Kathmandu is 23:45Z on the 17th. Grouping by UTC
    // files breakfast under the previous day.
    expect(hostelDayKey(new Date("2026-08-17T23:45:00Z"))).toBe("2026-08-18");
  });

  it("keeps a late meal on its own day", () => {
    // 23:50 local on the 18th is 18:05Z on the 18th.
    expect(hostelDayKey(new Date("2026-08-18T18:05:00Z"))).toBe("2026-08-18");
  });

  it("handles the 45-minute part of the offset, not just the hours", () => {
    // 00:10 local on the 19th is 18:25Z on the 18th. A +05:00 assumption puts
    // this at 23:25 on the 18th and gets the day wrong.
    expect(hostelDayKey(new Date("2026-08-18T18:25:00Z"))).toBe("2026-08-19");
  });

  it("formats as YYYY-MM-DD", () => {
    expect(hostelDayKey(new Date("2026-01-05T06:00:00Z"))).toBe("2026-01-05");
  });

  it("falls back to the UTC date rather than throwing on a bad zone", () => {
    expect(hostelDayKey(new Date("2026-08-18T12:00:00Z"), "Not/AZone")).toBe(
      "2026-08-18",
    );
  });
});

describe("groupPhotosByDay", () => {
  it("groups a day's meals together", () => {
    const days = groupPhotosByDay([
      photo("2026-08-18T13:45:00Z"),
      photo("2026-08-18T06:30:00Z"),
      photo("2026-08-17T13:45:00Z"),
    ]);

    expect(days).toHaveLength(2);
    expect(days[0]?.day).toBe("2026-08-18");
    expect(days[0]?.photos).toHaveLength(2);
    expect(days[1]?.day).toBe("2026-08-17");
  });

  it("keeps the order the query gave it", () => {
    // Newest-first in, newest-first out. Re-sorting here would be a second
    // opinion that can disagree with the query's.
    const days = groupPhotosByDay([
      photo("2026-08-18T13:45:00Z"),
      photo("2026-08-16T13:45:00Z"),
      photo("2026-08-17T13:45:00Z"),
    ]);

    expect(days.map((entry) => entry.day)).toEqual([
      "2026-08-18",
      "2026-08-16",
      "2026-08-17",
    ]);
  });

  it("emits one group per day even when the rows are not adjacent", () => {
    // The bug a naive fold has: a day that reappears later in the list becomes
    // a second group with the same name.
    const days = groupPhotosByDay([
      photo("2026-08-18T13:45:00Z"),
      photo("2026-08-17T13:45:00Z"),
      photo("2026-08-18T06:30:00Z"),
    ]);

    expect(days).toHaveLength(2);
    expect(days[0]?.photos).toHaveLength(2);
  });

  it("puts an early meal with the rest of its Nepal day", () => {
    // 05:30 and 19:30 local on the 18th: 23:45Z on the 17th and 13:45Z on the
    // 18th. Two UTC days, one Nepal day.
    const days = groupPhotosByDay([
      photo("2026-08-18T13:45:00Z"),
      photo("2026-08-17T23:45:00Z"),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]?.day).toBe("2026-08-18");
  });

  it("returns nothing for an empty feed", () => {
    expect(groupPhotosByDay([])).toEqual([]);
  });
});

describe("coveredMealCount", () => {
  it("counts distinct meals, not photos", () => {
    // Four photos of dinner is not the same as one of each meal, and a plain
    // length cannot tell those apart.
    expect(
      coveredMealCount([
        { mealType: "DINNER" },
        { mealType: "DINNER" },
        { mealType: "DINNER" },
        { mealType: "DINNER" },
      ]),
    ).toBe(1);

    expect(
      coveredMealCount([
        { mealType: "BREAKFAST" },
        { mealType: "LUNCH" },
        { mealType: "SNACKS" },
        { mealType: "DINNER" },
      ]),
    ).toBe(4);
  });

  it("is zero for a day with nothing posted", () => {
    expect(coveredMealCount([])).toBe(0);
  });
});
