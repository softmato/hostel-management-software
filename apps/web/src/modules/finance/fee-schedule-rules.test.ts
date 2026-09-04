import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * When a rate card may be written, replaced or dropped.
 *
 * Every case here comes from one owner's afternoon. They pressed a "next month"
 * button that added thirty days, got a card starting on the 17th, saw it badged
 * **Active** while a different card was actually billing their residents at ten
 * times the rate — and then could not correct any of it, because the only guard
 * compared dates and refused anything not later than what they had just saved.
 */

const mocks = vi.hoisted(() => ({
  auditFinanceAction: vi.fn(),
  connectToDatabase: vi.fn(),
  invoiceCountDocuments: vi.fn(),
  projectScheduleOntoListing: vi.fn(),
  scheduleCreate: vi.fn(),
  scheduleDeleteOne: vi.fn(),
  scheduleFind: vi.fn(),
  scheduleFindOne: vi.fn(),
  scheduleUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@/modules/finance/audit-finance", () => ({
  auditFinanceAction: mocks.auditFinanceAction,
}));

vi.mock("@/modules/finance/listing-projection.service", () => ({
  projectScheduleOntoListing: mocks.projectScheduleOntoListing,
}));

vi.mock("@hostel/db/models/FeeSchedule", () => ({
  FeeScheduleModel: {
    create: mocks.scheduleCreate,
    deleteOne: mocks.scheduleDeleteOne,
    find: mocks.scheduleFind,
    findOne: mocks.scheduleFindOne,
    updateOne: mocks.scheduleUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { countDocuments: mocks.invoiceCountDocuments },
}));

import {
  createFeeSchedule,
  deleteFeeSchedule,
  labelSchedules,
  scheduleStanding,
} from "@/modules/finance/fee-schedule.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const currentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const previousId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b2");

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: "64f0f0f0f0f0f0f0f0f0f0c1",
};

/** "Today" for every case: 3 September 2026, the day this was reported. */
const NOW = new Date("2026-09-03T04:00:00.000Z");

function card(overrides: Record<string, unknown> = {}) {
  return {
    _id: currentId,
    admissionFee: 2000,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    hostelId,
    rates: [{ bedType: "SINGLE", monthlyAmount: 18000, roomType: "Single Room" }],
    ...overrides,
  };
}

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), sort: vi.fn().mockReturnThis() };
}

const input = (effectiveFrom: string) => ({
  effectiveFrom: new Date(effectiveFrom),
  rates: [{ monthlyAmount: 18000, roomType: "Single Room" }],
});

/** The document handed to `FeeScheduleModel.create`. */
const created = () => mocks.scheduleCreate.mock.calls[0]?.[0];

describe("scheduleStanding", () => {
  it("calls a card for a future month upcoming, however open it is", () => {
    // The bug on the screen: `effectiveTo: null` was read as "in force", so a
    // card starting 3 October was badged Active on 3 September.
    expect(
      scheduleStanding(
        { effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
        NOW,
      ),
    ).toBe("upcoming");
  });

  it("calls the open card current once its month has started", () => {
    expect(
      scheduleStanding(
        { effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null },
        NOW,
      ),
    ).toBe("current");
  });

  it("calls a closed card past", () => {
    expect(
      scheduleStanding(
        {
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-07-31T00:00:00.000Z"),
        },
        NOW,
      ),
    ).toBe("past");
  });
});

describe("createFeeSchedule — when rates may change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    mocks.scheduleCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
      ...doc,
      _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1"),
    }));
    mocks.scheduleUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.scheduleDeleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.projectScheduleOntoListing.mockResolvedValue(null);
  });

  it("pulls a mid-month start back to the first of that month", async () => {
    // "17 Aswin" on the owner's screen. A card cannot begin mid-month: the
    // billing run gives a whole month to one card.
    mocks.scheduleFindOne.mockReturnValue(lean(card()));

    await createFeeSchedule(hostelId, input("2026-10-17T00:00:00.000Z"), principal);

    expect(created().effectiveFrom.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuses to change the month that is already billing", async () => {
    mocks.scheduleFindOne.mockReturnValue(lean(card()));

    await expect(
      createFeeSchedule(hostelId, input("2026-09-01T00:00:00.000Z"), principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_MONTH_LOCKED" });
    expect(mocks.scheduleCreate).not.toHaveBeenCalled();
  });

  it("lets a hostel with no card at all start one this month", async () => {
    // Until one exists nobody can be billed, so the first card is the exception.
    mocks.scheduleFindOne.mockReturnValue(lean(null));

    await createFeeSchedule(hostelId, input("2026-09-14T00:00:00.000Z"), principal);

    expect(created().effectiveFrom.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("replaces an upcoming card rather than refusing a second one", async () => {
    /*
     * The trap. October's rates were set wrong and could not be corrected until
     * October, because the guard only asked whether the new date was later. A
     * card that has priced nothing is not history.
     */
    mocks.scheduleFindOne.mockReturnValue(
      lean(card({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })),
    );

    await createFeeSchedule(hostelId, input("2026-10-01T00:00:00.000Z"), principal);

    expect(mocks.scheduleDeleteOne).toHaveBeenCalledWith({ _id: currentId });
    expect(mocks.scheduleUpdateOne).not.toHaveBeenCalled();
    expect(created().effectiveFrom.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("replaces it however the owner spelled the date", async () => {
    // 17 October and 1 October are the same card.
    mocks.scheduleFindOne.mockReturnValue(
      lean(card({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })),
    );

    await createFeeSchedule(hostelId, input("2026-10-22T00:00:00.000Z"), principal);

    expect(mocks.scheduleDeleteOne).toHaveBeenCalledWith({ _id: currentId });
  });

  it("closes a card that has started instead of replacing it", async () => {
    // This one is billing residents and an invoice may carry its id.
    mocks.scheduleFindOne.mockReturnValue(lean(card()));

    await createFeeSchedule(hostelId, input("2026-11-01T00:00:00.000Z"), principal);

    expect(mocks.scheduleDeleteOne).not.toHaveBeenCalled();
    expect(mocks.scheduleUpdateOne).toHaveBeenCalledWith(
      { _id: currentId },
      { $set: { effectiveTo: expect.any(Date) } },
    );
  });

  it("refuses a month earlier than one already scheduled", async () => {
    mocks.scheduleFindOne.mockReturnValue(
      lean(card({ effectiveFrom: new Date("2026-12-01T00:00:00.000Z") })),
    );

    await expect(
      createFeeSchedule(hostelId, input("2026-11-01T00:00:00.000Z"), principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_MISSING" });
  });

  it("writes the new rents onto the public listing", async () => {
    mocks.scheduleFindOne.mockReturnValue(lean(card()));

    await createFeeSchedule(hostelId, input("2026-10-01T00:00:00.000Z"), principal);

    expect(mocks.projectScheduleOntoListing).toHaveBeenCalled();
  });
});

describe("deleteFeeSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    mocks.invoiceCountDocuments.mockResolvedValue(0);
    mocks.scheduleDeleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.scheduleUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.projectScheduleOntoListing.mockResolvedValue(null);
  });

  it("drops upcoming rates and re-opens the card they displaced", async () => {
    /*
     * The half that makes delete safe. Opening a card closed its predecessor;
     * deleting it has to undo that, or a delete on *next* month's rates leaves
     * the hostel with no open card and stops billing for everybody.
     */
    mocks.scheduleFindOne
      .mockReturnValueOnce(
        lean(card({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })),
      )
      .mockReturnValueOnce(
        lean(
          card({
            _id: previousId,
            effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
            effectiveTo: new Date("2026-09-30T00:00:00.000Z"),
          }),
        ),
      );

    const result = await deleteFeeSchedule(hostelId, currentId.toString(), principal);

    expect(mocks.scheduleDeleteOne).toHaveBeenCalledWith({ _id: currentId });
    expect(mocks.scheduleUpdateOne).toHaveBeenCalledWith(
      { _id: previousId },
      { $set: { effectiveTo: null } },
    );
    expect(result.restoredId).toBe(previousId.toString());
  });

  it("puts the listing back to the rates that are running again", async () => {
    mocks.scheduleFindOne
      .mockReturnValueOnce(
        lean(card({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })),
      )
      .mockReturnValueOnce(lean(card({ _id: previousId })));

    await deleteFeeSchedule(hostelId, currentId.toString(), principal);

    expect(mocks.projectScheduleOntoListing).toHaveBeenCalled();
  });

  it("refuses rates that have already started", async () => {
    mocks.scheduleFindOne.mockReturnValue(lean(card()));

    await expect(
      deleteFeeSchedule(hostelId, currentId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_MONTH_LOCKED" });
    expect(mocks.scheduleDeleteOne).not.toHaveBeenCalled();
  });

  it("refuses rates that have priced an invoice, whatever their dates say", async () => {
    // An orphaned `feeScheduleId` makes "what was this resident's rent in
    // March?" unanswerable, which is the question versioning exists to answer.
    mocks.scheduleFindOne.mockReturnValue(
      lean(card({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") })),
    );
    mocks.invoiceCountDocuments.mockResolvedValue(2);

    await expect(
      deleteFeeSchedule(hostelId, currentId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_IN_USE" });
    expect(mocks.scheduleDeleteOne).not.toHaveBeenCalled();
  });

  it("reports a card that is not there", async () => {
    mocks.scheduleFindOne.mockReturnValue(lean(null));

    await expect(
      deleteFeeSchedule(hostelId, currentId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_MISSING" });
  });
});

/**
 * Which card is "current" — the question the Finance screen got backwards in
 * both directions at once.
 *
 * The live shape that exposed it: September's rates sat on a card closed on
 * 1 October to make room for a successor, so it had an `effectiveTo` and read as
 * finished; the successor had no `effectiveTo` and read as active, but did not
 * start for another month. The owner was shown 18,000 as live while their
 * residents were invoiced at 180,000 from the card filed under history.
 */
describe("labelSchedules", () => {
  const september = {
    _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1"),
    effectiveFrom: new Date("2026-08-31T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-01T18:15:00.000Z"),
  };
  const october = {
    _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e2"),
    effectiveFrom: new Date("2026-10-02T18:15:00.000Z"),
    effectiveTo: null,
  };
  const july = {
    _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e3"),
    effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-08-20T18:15:00.000Z"),
  };

  const standings = (now: Date) =>
    Object.fromEntries(
      labelSchedules([october, september, july], now).map((schedule) => [
        schedule._id.toString(),
        schedule.standing,
      ]),
    );

  it("calls a closed card current when it is the one billing this month", () => {
    // Closed on 1 October, but on 3 September it is what residents are paying.
    expect(standings(NOW)[september._id.toString()]).toBe("current");
  });

  it("does not call an open card current before its month arrives", () => {
    expect(standings(NOW)[october._id.toString()]).toBe("upcoming");
  });

  it("calls a card that ended before this month past", () => {
    expect(standings(NOW)[july._id.toString()]).toBe("past");
  });

  it("hands over on the first of the month the new card starts", () => {
    const inOctober = standings(new Date("2026-10-05T04:00:00.000Z"));

    expect(inOctober[october._id.toString()]).toBe("current");
    expect(inOctober[september._id.toString()]).toBe("past");
  });

  it("names exactly one card current", () => {
    // Two overlapping cards is the ambiguity the open-row index exists to
    // prevent; the label must not reintroduce it.
    const labelled = labelSchedules([october, september, july], NOW);

    expect(labelled.filter((schedule) => schedule.standing === "current")).toHaveLength(1);
  });

  it("names none current when nothing covers this month", () => {
    // A real and reportable state: rates booked for the future, nobody billable
    // now. The old screen could not show it at all.
    const labelled = labelSchedules([october], NOW);

    expect(labelled[0]!.standing).toBe("upcoming");
  });
});
