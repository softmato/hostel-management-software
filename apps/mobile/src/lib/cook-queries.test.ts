import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CookToday, FoodReadyAnnouncement, FoodReadySent } from "@/lib/cook-api";
import { cookQuery, recordCookAnnouncement } from "@/lib/cook-queries";
import { readQuery, resetQueryCache, writeQuery } from "@/lib/query-cache";

/*
 * `cook-api` reaches `lib/api`, which is axios on React Native — Flow source
 * that this node-side runner cannot parse. The loaders are never called here:
 * every test in this file is about what the cache holds, not about fetching.
 */
vi.mock("@/lib/cook-api", () => ({
  getCookToday: vi.fn(),
  listCookFoodPhotos: vi.fn(),
  listCookResidents: vi.fn(),
  listFoodReadyLogs: vi.fn(),
}));

function sent(overrides: Partial<FoodReadySent> = {}): FoodReadySent {
  return {
    announcedAt: "2026-09-05T06:30:00.000Z",
    id: "a-new",
    mealType: "LUNCH",
    message: "Today's lunch: Dal bhat",
    notifiedCount: 38,
    staffNotifiedCount: 3,
    ...overrides,
  };
}

function today(overrides: Partial<CookToday> = {}): CookToday {
  return {
    announced: [],
    date: "2026-09-05",
    hostel: { id: "h1", name: "Sunrise", slug: "sunrise" },
    meals: [],
    residentCount: 38,
    routine: { meals: [], timings: {} } as unknown as CookToday["routine"],
    ...overrides,
  };
}

describe("recordCookAnnouncement", () => {
  beforeEach(() => {
    resetQueryCache();
  });

  it("puts the announcement the server just returned on the Today tab", () => {
    const key = cookQuery.today().key;
    writeQuery(key, today(), cookQuery.today().topics);

    recordCookAnnouncement(sent());

    // Newest first, which is the order `mealButtons` reads to find the latest
    // announcement for a meal.
    expect(readQuery<CookToday>(key)?.data.announced.map((row) => row.id)).toEqual([
      "a-new",
    ]);
  });

  it("updates the record on More from the same call", () => {
    const key = cookQuery.announcements().key;
    writeQuery(key, [{ id: "a-old" } as FoodReadyAnnouncement], cookQuery
      .announcements()
      .topics);

    recordCookAnnouncement(sent());

    expect(
      readQuery<FoodReadyAnnouncement[]>(key)?.data.map((row) => row.id),
    ).toEqual(["a-new", "a-old"]);
  });

  /*
   * A key nothing has loaded is left alone rather than seeded with a one-row
   * list: the tab that eventually asks for it would then paint a "record" of a
   * single announcement and treat it as fresh, hiding every earlier one until
   * something invalidated it.
   */
  it("leaves a key that was never loaded empty", () => {
    recordCookAnnouncement(sent());

    expect(readQuery(cookQuery.today().key)).toBeNull();
    expect(readQuery(cookQuery.announcements().key)).toBeNull();
  });

  /*
   * `residentCount` rides on `cook:today`, so a resident moving in changes that
   * payload — it has to move on the `residents` topic as well as `food`, or the
   * head count on Today and the roster on Menu disagree for one hostel.
   */
  it("keeps the head count on the same topic as the roster", () => {
    expect(cookQuery.today().topics).toEqual(
      expect.arrayContaining([...cookQuery.residents().topics]),
    );
  });
});
