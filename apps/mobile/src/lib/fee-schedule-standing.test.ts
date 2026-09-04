import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app must not need a matching API deploy to show a hostel its rates.
 *
 * This is a real outage in miniature. The build shipped reading `standing`, a
 * field the server computes; the phone it landed on was talking to an API that
 * predated it. Every card came back unlabelled, nothing matched `current` or
 * `upcoming`, and a hostel with three rate cards was told **No rates set** — on
 * the screen that decides what its residents are charged.
 */

/*
 * `vi.hoisted`, because `vi.mock` is hoisted above every `const` in this file.
 *
 * This suite has never run. It was written as `const get = vi.fn()` with the
 * factory closing over it, which throws `Cannot access 'get' before
 * initialization` at collection time — so the file counted as one failure and
 * none of its assertions counted at all. `vi.hoisted` is the seam Vitest
 * provides for exactly this: the mock and the spy it needs are lifted together.
 *
 * It is also the only test in `apps/mobile` that mocks `@/lib/api`. Everywhere
 * else the pure half is split into its own module so the node-side runner can
 * import it without touching React Native — see `notification-preferences.ts`
 * beside `notification-preferences-api.ts`. Worth doing here too; not worth
 * doing in the same pass as fixing the hoist.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({
  API_BASE_URL: "https://example.test",
  api: { delete: vi.fn(), get, patch: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

// eslint-disable-next-line import/first -- must follow the `vi.mock` above.
import { listFeeSchedules } from "@/lib/admin-manage-api";

/** 3 September 2026 — the day this was reported. */
const NOW = new Date("2026-09-03T04:00:00.000Z");

/** The hostel's real cards, exactly as the API returns them. */
const SCHEDULES = [
  {
    _id: "october",
    effectiveFrom: "2026-10-02T18:15:00.000Z",
    effectiveTo: null,
    rates: [{ monthlyAmount: 18000, roomType: "Single Room" }],
  },
  {
    _id: "september",
    effectiveFrom: "2026-08-31T00:00:00.000Z",
    effectiveTo: "2026-10-01T18:15:00.000Z",
    rates: [
      { monthlyAmount: 18000, roomType: "Single Room" },
      { monthlyAmount: 12000, roomType: "Four Sharing" },
    ],
  },
  {
    _id: "july",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveTo: "2026-08-20T18:15:00.000Z",
    rates: [{ monthlyAmount: 18000, roomType: "Single Room" }],
  },
];

function reply(data: unknown) {
  get.mockResolvedValue({ data: { data, success: true } });
}

const standings = (schedules: { _id: string; standing?: string }[]) =>
  Object.fromEntries(schedules.map((schedule) => [schedule._id, schedule.standing]));

describe("listFeeSchedules against an API without `standing`", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("labels the cards itself rather than returning none", async () => {
    reply({ schedules: SCHEDULES });

    const { schedules } = await listFeeSchedules();

    expect(standings(schedules)).toEqual({
      july: "past",
      october: "upcoming",
      september: "current",
    });
  });

  it("calls the closed card current when it is the one billing this month", async () => {
    // September's rates were closed on 1 October to make room for a successor.
    // `effectiveTo !== null` does not mean finished.
    reply({ schedules: SCHEDULES });

    const { schedules } = await listFeeSchedules();

    expect(schedules.find((s) => s._id === "september")?.standing).toBe("current");
  });

  it("does not call the open card current before its month arrives", async () => {
    reply({ schedules: SCHEDULES });

    const { schedules } = await listFeeSchedules();

    expect(schedules.find((s) => s._id === "october")?.standing).toBe("upcoming");
  });

  it("recovers the room types so the rate editor still has boxes", async () => {
    reply({ schedules: SCHEDULES });

    const { roomTypes } = await listFeeSchedules();

    expect(roomTypes.map((option) => option.roomType)).toEqual([
      "Four Sharing",
      "Single Room",
    ]);
  });

  it("names a bed type when a card predates the room-type re-key", async () => {
    reply({
      schedules: [
        {
          _id: "old",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          rates: [{ bedType: "SINGLE", monthlyAmount: 18000 }],
        },
      ],
    });

    const { roomTypes } = await listFeeSchedules();

    expect(roomTypes.map((option) => option.roomType)).toEqual(["SINGLE"]);
  });

  it("leaves the server's own labels alone when it sends them", async () => {
    // The server is the authority; this fallback exists only for its absence.
    reply({
      roomTypes: [{ monthlyRent: 18000, roomType: "Single Room" }],
      schedules: [{ ...SCHEDULES[0], standing: "current" }],
    });

    const { roomTypes, schedules } = await listFeeSchedules();

    expect(schedules[0]!.standing).toBe("current");
    expect(roomTypes).toEqual([{ monthlyRent: 18000, roomType: "Single Room" }]);
  });

  it("survives an API that sends no schedules at all", async () => {
    reply({});

    await expect(listFeeSchedules()).resolves.toEqual({ roomTypes: [], schedules: [] });
  });
});
