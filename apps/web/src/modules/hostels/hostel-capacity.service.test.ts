import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capacityMocks = vi.hoisted(() => ({
  hostelFindOne: vi.fn(),
  hostelUpdateOne: vi.fn(),
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: {
    findOne: capacityMocks.hostelFindOne,
    updateOne: capacityMocks.hostelUpdateOne,
  },
}));

import {
  claimBedForRoomType,
  listAvailableRoomTypes,
  moveBedBetweenRoomTypes,
  releaseBedForRoomType,
  summarizeConfigurations,
} from "@/modules/hostels/hostel-capacity.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f4");

function withConfigurations(roomConfigurations: unknown[]) {
  capacityMocks.hostelFindOne.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ roomConfigurations }),
    }),
  });
}

/** The roomConfigurations array as it was written back to the hostel. */
function writtenConfigurations() {
  const lastCall = capacityMocks.hostelUpdateOne.mock.calls.at(-1)!;

  return lastCall[1].$set.roomConfigurations;
}

describe("hostel capacity counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacityMocks.hostelUpdateOne.mockResolvedValue({});
  });

  describe("summarizeConfigurations", () => {
    it("totals rooms, beds and vacancy across room types", () => {
      expect(
        summarizeConfigurations([
          { bedsPerRoom: 1, rooms: 10, roomType: "Single Room", vacantBeds: 5 },
          { bedsPerRoom: 4, rooms: 20, roomType: "Four Sharing", vacantBeds: 20 },
        ]),
      ).toEqual({ totalBeds: 90, totalRooms: 30, vacantBeds: 25 });
    });
  });

  describe("claimBedForRoomType", () => {
    it("decrements only the chosen room type", async () => {
      withConfigurations([
        { bedsPerRoom: 1, rooms: 10, roomType: "Single Room", vacantBeds: 5 },
        { bedsPerRoom: 4, rooms: 20, roomType: "Four Sharing", vacantBeds: 20 },
      ]);

      await claimBedForRoomType(hostelId, "Four Sharing");

      expect(writtenConfigurations()).toEqual([
        expect.objectContaining({ roomType: "Single Room", vacantBeds: 5 }),
        expect.objectContaining({ roomType: "Four Sharing", vacantBeds: 19 }),
      ]);
    });

    it("keeps capacitySummary in step with the new counts", async () => {
      withConfigurations([
        { bedsPerRoom: 2, rooms: 3, roomType: "Two Sharing", vacantBeds: 6 },
      ]);

      await claimBedForRoomType(hostelId, "Two Sharing");

      const lastCall = capacityMocks.hostelUpdateOne.mock.calls.at(-1)!;

      expect(lastCall[1].$set.capacitySummary).toEqual({
        totalBeds: 6,
        totalRooms: 3,
        vacantBeds: 5,
      });
    });

    it("refuses when the room type has no vacancy left", async () => {
      withConfigurations([
        { bedsPerRoom: 4, rooms: 1, roomType: "Four Sharing", vacantBeds: 0 },
      ]);

      await expect(claimBedForRoomType(hostelId, "Four Sharing")).rejects.toMatchObject({
        errorCode: "ROOM_TYPE_FULL",
        status: 409,
      });
      expect(capacityMocks.hostelUpdateOne).not.toHaveBeenCalled();
    });

    it("refuses a room type the hostel does not have", async () => {
      withConfigurations([
        { bedsPerRoom: 1, rooms: 2, roomType: "Single Room", vacantBeds: 2 },
      ]);

      await expect(claimBedForRoomType(hostelId, "Penthouse")).rejects.toMatchObject({
        errorCode: "ROOM_TYPE_NOT_FOUND",
        status: 404,
      });
      expect(capacityMocks.hostelUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("releaseBedForRoomType", () => {
    it("gives the bed back", async () => {
      withConfigurations([
        { bedsPerRoom: 4, rooms: 2, roomType: "Four Sharing", vacantBeds: 3 },
      ]);

      await releaseBedForRoomType(hostelId, "Four Sharing");

      expect(writtenConfigurations()).toEqual([
        expect.objectContaining({ vacantBeds: 4 }),
      ]);
    });

    it("never reports more vacancy than the room type has beds", async () => {
      withConfigurations([
        { bedsPerRoom: 2, rooms: 1, roomType: "Two Sharing", vacantBeds: 2 },
      ]);

      await releaseBedForRoomType(hostelId, "Two Sharing");

      expect(writtenConfigurations()).toEqual([
        expect.objectContaining({ vacantBeds: 2 }),
      ]);
    });

    it("ignores a room type that no longer exists so move-out still works", async () => {
      withConfigurations([
        { bedsPerRoom: 1, rooms: 1, roomType: "Single Room", vacantBeds: 0 },
      ]);

      const result = await releaseBedForRoomType(hostelId, "Retired Type");

      expect(result.released).toBe(false);
      expect(capacityMocks.hostelUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("moveBedBetweenRoomTypes", () => {
    it("does not touch the old type when the new one is full", async () => {
      withConfigurations([
        { bedsPerRoom: 1, rooms: 1, roomType: "Single Room", vacantBeds: 0 },
        { bedsPerRoom: 4, rooms: 1, roomType: "Four Sharing", vacantBeds: 2 },
      ]);

      await expect(
        moveBedBetweenRoomTypes(hostelId, "Four Sharing", "Single Room"),
      ).rejects.toMatchObject({ errorCode: "ROOM_TYPE_FULL" });
      expect(capacityMocks.hostelUpdateOne).not.toHaveBeenCalled();
    });

    it("is a no-op when the room type is unchanged", async () => {
      await moveBedBetweenRoomTypes(hostelId, "Four Sharing", "Four Sharing");

      expect(capacityMocks.hostelFindOne).not.toHaveBeenCalled();
    });
  });

  describe("listAvailableRoomTypes", () => {
    it("returns only room types with a free bed", async () => {
      withConfigurations([
        { bedsPerRoom: 1, rooms: 5, roomType: "Single Room", vacantBeds: 0 },
        {
          bedsPerRoom: 4,
          monthlyRent: 10000,
          rooms: 20,
          roomType: "Four Sharing",
          vacantBeds: 20,
        },
      ]);

      expect(await listAvailableRoomTypes(hostelId)).toEqual([
        { monthlyRent: 10000, roomType: "Four Sharing", vacantBeds: 20 },
      ]);
    });
  });
});
