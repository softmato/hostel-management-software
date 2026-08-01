import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  attendanceFindOneAndUpdate: vi.fn(),
  connectToDatabase: vi.fn(),
  consentFindOne: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelSettingsFindOne: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AttendanceLog", () => ({
  AttendanceLogModel: {
    deleteMany: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: mocks.attendanceFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/AttendanceAlert", () => ({
  AttendanceAlertModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/ConsentLog", () => ({
  ConsentLogModel: { create: vi.fn(), findOne: mocks.consentFindOne },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/HostelSettings", () => ({
  HostelSettingsModel: { findOne: mocks.hostelSettingsFindOne, updateOne: vi.fn() },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: vi.fn() },
}));

import {
  ATTENDANCE_DEFAULTS,
  dayKey,
  distanceMeters,
  recordLocationPing,
  zoneForDistance,
} from "@/modules/attendance/attendance.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0e1";
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e2");

const residentPrincipal = {
  hostelIds: [hostelId],
  role: Role.RESIDENT,
  sessionId: "session-r",
  userId: "64f0f0f0f0f0f0f0f0f0f0e3",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function selectResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
  };
}

function sortedResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    sort: vi.fn().mockReturnThis(),
  };
}

describe("attendance zone maths", () => {
  it("measures a known distance to within a metre or two", () => {
    // Two points ~111m apart on the same meridian (0.001° of latitude).
    const meters = distanceMeters({ lat: 27.7, lng: 85.3 }, { lat: 27.701, lng: 85.3 });

    expect(meters).toBeGreaterThan(109);
    expect(meters).toBeLessThan(113);
  });

  it("maps distance onto the configured zones, boundaries inclusive", () => {
    expect(zoneForDistance(0, ATTENDANCE_DEFAULTS)).toBe("INSIDE");
    expect(zoneForDistance(50, ATTENDANCE_DEFAULTS)).toBe("INSIDE");
    expect(zoneForDistance(51, ATTENDANCE_DEFAULTS)).toBe("NEARBY");
    expect(zoneForDistance(200, ATTENDANCE_DEFAULTS)).toBe("NEARBY");
    expect(zoneForDistance(201, ATTENDANCE_DEFAULTS)).toBe("OUTSIDE");
  });

  it("buckets a timestamp to UTC midnight", () => {
    expect(dayKey(new Date("2030-03-04T23:59:59.000Z")).toISOString()).toBe(
      "2030-03-04T00:00:00.000Z",
    );
  });
});

describe("location ping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.residentFindOne.mockReturnValue(
      leanResult({
        _id: residentId,
        depositAmount: 0,
        firstName: "Asha",
        hostelId: new Types.ObjectId(hostelId),
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        roomType: "DOUBLE",
        status: "ACTIVE",
      }),
    );
    mocks.consentFindOne.mockReturnValue(sortedResult({ granted: true }));
    mocks.hostelSettingsFindOne.mockReturnValue(
      leanResult({ attendance: { ...ATTENDANCE_DEFAULTS, enabled: true } }),
    );
    mocks.hostelFindOne.mockReturnValue(
      selectResult({ location: { lat: 27.7, lng: 85.3 } }),
    );
    mocks.attendanceFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e4"),
        day: new Date("2030-03-04T00:00:00.000Z"),
        distanceMeters: 12,
        hostelId: new Types.ObjectId(hostelId),
        recordedAt: new Date("2030-03-04T08:00:00.000Z"),
        residentId,
        source: "MOBILE_PING",
        zone: "INSIDE",
      }),
    );
  });

  it("stores the zone and never the coordinates", async () => {
    await recordLocationPing(
      { lat: 27.7001, lng: 85.3001, recordedAt: new Date("2030-03-04T08:00:00.000Z") },
      residentPrincipal,
    );

    const [, update] = mocks.attendanceFindOneAndUpdate.mock.calls[0];
    const written = JSON.stringify(update);

    expect(update.$set.zone).toBe("INSIDE");
    expect(written).not.toContain("27.7001");
    expect(written).not.toContain("85.3001");
    expect(written).not.toContain("lat");
    expect(written).not.toContain("lng");
  });

  it("refuses without consent", async () => {
    mocks.consentFindOne.mockReturnValue(sortedResult({ granted: false }));

    await expect(
      recordLocationPing({ lat: 27.7, lng: 85.3 }, residentPrincipal),
    ).rejects.toMatchObject({ errorCode: "LOCATION_CONSENT_REQUIRED" });
    expect(mocks.attendanceFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses when the hostel has tracking switched off", async () => {
    mocks.hostelSettingsFindOne.mockReturnValue(
      leanResult({ attendance: { enabled: false } }),
    );

    await expect(
      recordLocationPing({ lat: 27.7, lng: 85.3 }, residentPrincipal),
    ).rejects.toMatchObject({ errorCode: "ATTENDANCE_DISABLED" });
  });

  it("records UNKNOWN rather than guessing when the hostel has no pin", async () => {
    mocks.hostelFindOne.mockReturnValue(selectResult({ location: {} }));

    await recordLocationPing({ lat: 27.7, lng: 85.3 }, residentPrincipal);

    const [, update] = mocks.attendanceFindOneAndUpdate.mock.calls[0];

    expect(update.$set.zone).toBe("UNKNOWN");
    expect(update.$set.distanceMeters).toBeUndefined();
  });
});
