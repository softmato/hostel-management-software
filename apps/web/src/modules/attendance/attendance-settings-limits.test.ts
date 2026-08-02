import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelSettingsFindOne: vi.fn(),
  hostelSettingsUpdateOne: vi.fn(),
  operationsConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AttendanceLog", () => ({
  AttendanceLogModel: { deleteMany: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/AttendanceAlert", () => ({
  AttendanceAlertModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/ConsentLog", () => ({
  ConsentLogModel: { create: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { findOne: vi.fn() } }));

vi.mock("@hostel/db/models/HostelSettings", () => ({
  HostelSettingsModel: {
    findOne: mocks.hostelSettingsFindOne,
    updateOne: mocks.hostelSettingsUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@/modules/platform-config/operations-config", () => ({
  getOperationsConfig: mocks.operationsConfig,
}));

import { updateAttendanceSettings } from "@/modules/attendance/attendance.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0e1";

const adminPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-a",
  userId: "64f0f0f0f0f0f0f0f0f0f0e4",
};

const PLATFORM_LIMITS = {
  maxAttendanceRetentionDays: 600,
  maxInsideZoneRadiusMeters: 100,
  maxNearbyZoneRadiusMeters: 500,
};

describe("hostel attendance settings stay inside the platform limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationsConfig.mockResolvedValue(PLATFORM_LIMITS);
    mocks.hostelSettingsFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
      select: vi.fn().mockReturnThis(),
    });
    mocks.hostelSettingsUpdateOne.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
  });

  it("saves a geofence within the ceilings", async () => {
    const result = await updateAttendanceSettings(
      { insideZoneRadiusMeters: 80, nearbyZoneRadiusMeters: 400 },
      adminPrincipal,
    );

    expect(result.settings.insideZoneRadiusMeters).toBe(80);
    expect(mocks.hostelSettingsUpdateOne).toHaveBeenCalled();
  });

  it("refuses an inside radius above the platform ceiling", async () => {
    await expect(
      updateAttendanceSettings(
        { insideZoneRadiusMeters: 300, nearbyZoneRadiusMeters: 450 },
        adminPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "GEOFENCE_ABOVE_PLATFORM_LIMIT" });

    expect(mocks.hostelSettingsUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses a nearby radius above the platform ceiling", async () => {
    await expect(
      updateAttendanceSettings({ nearbyZoneRadiusMeters: 1500 }, adminPrincipal),
    ).rejects.toMatchObject({ errorCode: "GEOFENCE_ABOVE_PLATFORM_LIMIT" });
  });

  // Retention is the privacy-relevant knob: a hostel must not be able to keep
  // raw location logs longer than the platform allows.
  it("refuses a retention window above the platform ceiling", async () => {
    await expect(
      updateAttendanceSettings({ retentionDays: 1000 }, adminPrincipal),
    ).rejects.toMatchObject({ errorCode: "RETENTION_ABOVE_PLATFORM_LIMIT" });

    expect(mocks.hostelSettingsUpdateOne).not.toHaveBeenCalled();
  });

  it("still rejects a nearby radius smaller than the inside radius", async () => {
    await expect(
      updateAttendanceSettings(
        { insideZoneRadiusMeters: 90, nearbyZoneRadiusMeters: 50 },
        adminPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_GEOFENCE" });
  });
});
