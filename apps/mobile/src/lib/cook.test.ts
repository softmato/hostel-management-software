import { describe, expect, it } from "vitest";

import type { FoodReadyAnnouncement } from "@/lib/cook-api";
import {
  announcedCount,
  mealButtonLabel,
  mealButtons,
  mealSubtitle,
  reachedNobody,
} from "@/lib/cook";
import type { RoutineMeal } from "@/lib/resident-api";

function meal(overrides: Partial<RoutineMeal> = {}): RoutineMeal {
  return {
    dayOfWeek: "MONDAY",
    items: ["Dal bhat"],
    mealType: "LUNCH",
    note: "",
    timing: "12:30",
    ...overrides,
  };
}

function announcement(
  overrides: Partial<FoodReadyAnnouncement> = {},
): FoodReadyAnnouncement {
  return {
    announcedAt: "2026-08-17T07:00:00.000Z",
    id: "log-1",
    mealType: "LUNCH",
    message: "Today's lunch: Dal bhat, chicken",
    notifiedCount: 38,
    ...overrides,
  };
}

describe("mealButtons", () => {
  /*
   * Always four. A kitchen serving an unplanned snack still needs to tell
   * people, and hiding the button because an admin left a cell blank makes the
   * app least useful exactly when the routine is out of date.
   */
  it("always offers all four meals in serving order", () => {
    const buttons = mealButtons([], []);

    expect(buttons.map((button) => button.mealType)).toEqual([
      "BREAKFAST",
      "LUNCH",
      "SNACKS",
      "DINNER",
    ]);
  });

  it("labels an unplanned meal rather than dropping it", () => {
    const [breakfast] = mealButtons([meal()], []);

    expect(breakfast?.items).toEqual([]);
    expect(mealSubtitle(breakfast!)).toBe("Nothing planned for today");
  });

  it("carries today's items and timing onto the button", () => {
    const buttons = mealButtons([meal()], []);
    const lunch = buttons.find((button) => button.mealType === "LUNCH");

    expect(lunch?.items).toEqual(["Dal bhat"]);
    expect(lunch?.timing).toBe("12:30");
  });

  it("marks a meal that has already gone out", () => {
    const buttons = mealButtons([meal()], [announcement()]);
    const lunch = buttons.find((button) => button.mealType === "LUNCH");

    expect(lunch?.sent?.notifiedCount).toBe(38);
    expect(announcedCount(buttons)).toBe(1);
  });

  it("keeps the latest announcement when a meal was called twice", () => {
    // Server order is newest first.
    const buttons = mealButtons(
      [meal()],
      [
        announcement({ id: "second", message: "Lunch is ready (second sitting)" }),
        announcement({ id: "first" }),
      ],
    );

    expect(buttons.find((button) => button.mealType === "LUNCH")?.sent?.id).toBe("second");
  });
});

describe("mealButtonLabel", () => {
  /*
   * Not a disabled button. The server owns the cooldown and returns a 429
   * naming the wait; a cook re-calling a late sitting must be able to try, and
   * a client-side rule would drift the moment `foodReadyCooldownMinutes`
   * changes.
   */
  it("offers a second announcement rather than locking the button", () => {
    const [, lunch] = mealButtons([meal()], [announcement()]);

    expect(mealButtonLabel(lunch!)).toBe("Announce again");
  });

  it("reads plainly the first time", () => {
    const [breakfast] = mealButtons([], []);

    expect(mealButtonLabel(breakfast!)).toBe("Food ready");
  });
});

describe("mealSubtitle", () => {
  it("prefers what was announced over what was planned", () => {
    const buttons = mealButtons(
      [meal({ items: ["Dal bhat"] })],
      [announcement({ message: "Today's lunch: Dal bhat, chicken" })],
    );

    expect(mealSubtitle(buttons.find((button) => button.mealType === "LUNCH")!)).toBe(
      "Today's lunch: Dal bhat, chicken",
    );
  });
});

describe("reachedNobody", () => {
  /*
   * A 201 means the announcement was recorded, not that anyone heard it — the
   * same trap as the SOS fan-out. A hostel whose residents have no accounts
   * gets zero.
   */
  it("catches an announcement that notified no one", () => {
    expect(reachedNobody(announcement({ notifiedCount: 0 }))).toBe(true);
    expect(reachedNobody(announcement({ notifiedCount: 1 }))).toBe(false);
  });
});
