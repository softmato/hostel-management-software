import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  historyCreate: vi.fn(),
  publishResourceChange: vi.fn(),
  requestFindOne: vi.fn(),
  requestFindOneAndUpdate: vi.fn(),
  serviceProviderFindOne: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@/lib/realtime/server", () => ({
  publishResourceChange: mocks.publishResourceChange,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/MaintenanceHistory", () => ({
  MaintenanceHistoryModel: { create: mocks.historyCreate },
}));

vi.mock("@hostel/db/models/MaintenanceRequest", () => ({
  MaintenanceRequestModel: {
    find: vi.fn(),
    findOne: mocks.requestFindOne,
    findOneAndUpdate: mocks.requestFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/ServiceProvider", () => ({
  ServiceProviderModel: { findOne: mocks.serviceProviderFindOne },
}));

vi.mock("@hostel/db/models/ServiceProviderApplication", () => ({
  ServiceProviderApplicationModel: { findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/ServiceProviderDocument", () => ({
  ServiceProviderDocumentModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { find: vi.fn() } }));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findById: mocks.userFindById, findOne: vi.fn(), updateOne: vi.fn() },
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  appUrl: (path: string) => `https://test.local${path}`,
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/site-config-server", () => ({ loadSiteConfig: vi.fn() }));

vi.mock("@/modules/users/id-card-delivery.service", () => ({ sendIdCardEmail: vi.fn() }));

vi.mock("@/modules/service-providers/service-provider-notify", () => ({
  notifyPlatformOfServiceProviderApplication: vi.fn(),
}));

import { updateOwnServiceProviderJobStatus } from "@/modules/service-providers/service-provider.service";

const userId = "64f0f0f0f0f0f0f0f0f0f0a1";
const providerId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");
const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3");
const jobId = "64f0f0f0f0f0f0f0f0f0f0a4";

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function providerQuery<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), sort: vi.fn().mockReturnThis() };
}

function selectQuery<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(jobId),
    category: "PLUMBING",
    hostelId,
    priority: "MEDIUM",
    status: "PENDING",
    title: "Leaking tap",
    ...overrides,
  };
}

describe("updateOwnServiceProviderJobStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindById.mockReturnValue(selectQuery({ email: "plumber@example.com" }));
    mocks.serviceProviderFindOne.mockReturnValue(
      providerQuery({ _id: providerId, fullName: "Ram Plumbing", status: "APPROVED" }),
    );
    mocks.requestFindOne.mockReturnValue(leanResult(job()));
    mocks.requestFindOneAndUpdate.mockReturnValue(
      leanResult(job({ status: "CONTACTED" })),
    );
  });

  /*
   * The scope that makes the route safe: the id in the path is only ever
   * resolved *within* the caller's own assignments, so a job belonging to
   * another provider cannot be reached by guessing an id.
   */
  it("only ever looks for the job among the caller's own assignments", async () => {
    await updateOwnServiceProviderJobStatus(userId, jobId, { status: "CONTACTED" });

    expect(mocks.requestFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ providerId, isDeleted: false }),
    );
  });

  it("reports another provider's job as a plain miss, not a 403", async () => {
    mocks.requestFindOne.mockReturnValue(leanResult(null));

    await expect(
      updateOwnServiceProviderJobStatus(userId, jobId, { status: "COMPLETED" }),
    ).rejects.toMatchObject({ errorCode: "MAINTENANCE_REQUEST_NOT_FOUND", status: 404 });
  });

  it("treats an unapproved account the same way", async () => {
    mocks.serviceProviderFindOne.mockReturnValue(providerQuery(null));

    await expect(
      updateOwnServiceProviderJobStatus(userId, jobId, { status: "COMPLETED" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.requestFindOne).not.toHaveBeenCalled();
  });

  it("stamps completedAt only when the job is finished", async () => {
    mocks.requestFindOneAndUpdate.mockReturnValue(
      leanResult(job({ completedAt: new Date("2026-08-17T10:00:00.000Z"), status: "COMPLETED" })),
    );

    const result = await updateOwnServiceProviderJobStatus(userId, jobId, {
      status: "COMPLETED",
    });

    expect(mocks.requestFindOneAndUpdate.mock.calls[0]?.[1]).toMatchObject({
      $set: expect.objectContaining({ completedAt: expect.any(Date), status: "COMPLETED" }),
    });
    expect(result.job.completedAt).toBe("2026-08-17T10:00:00.000Z");
  });

  it("does not stamp completedAt on a contact", async () => {
    await updateOwnServiceProviderJobStatus(userId, jobId, { status: "CONTACTED" });

    expect(mocks.requestFindOneAndUpdate.mock.calls[0]?.[1]).toEqual({
      $set: expect.not.objectContaining({ completedAt: expect.anything() }),
    });
  });

  /*
   * Reopening a closed job is the hostel's call. Without this, a second tap
   * after a slow response would rewrite the completion date.
   */
  it("refuses a job that is already closed", async () => {
    mocks.requestFindOne.mockReturnValue(leanResult(job({ status: "COMPLETED" })));

    await expect(
      updateOwnServiceProviderJobStatus(userId, jobId, { status: "COMPLETED" }),
    ).rejects.toMatchObject({ errorCode: "MAINTENANCE_REQUEST_CLOSED", status: 409 });
  });

  it("refuses a cancelled job too", async () => {
    mocks.requestFindOne.mockReturnValue(leanResult(job({ status: "CANCELLED" })));

    await expect(
      updateOwnServiceProviderJobStatus(userId, jobId, { status: "CONTACTED" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  /*
   * The update is pinned to the status that was read, so two taps racing each
   * other cannot both win.
   */
  it("pins the write to the status it read, and 409s when it lost the race", async () => {
    mocks.requestFindOneAndUpdate.mockReturnValue(leanResult(null));

    await expect(
      updateOwnServiceProviderJobStatus(userId, jobId, { status: "COMPLETED" }),
    ).rejects.toMatchObject({ errorCode: "MAINTENANCE_REQUEST_CONFLICT", status: 409 });

    expect(mocks.requestFindOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({
      status: "PENDING",
    });
  });

  it("records history, an audit row, and wakes the hostel's queue", async () => {
    await updateOwnServiceProviderJobStatus(userId, jobId, {
      note: "On my way",
      status: "CONTACTED",
    });

    expect(mocks.historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        nextStatus: "CONTACTED",
        note: "On my way",
        previousStatus: "PENDING",
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "MaintenanceRequest",
        metadata: expect.objectContaining({ source: "SERVICE_PROVIDER" }),
      }),
    );
    expect(mocks.publishResourceChange).toHaveBeenCalledWith({
      hostelIds: [hostelId.toString()],
      topics: ["maintenance"],
    });
  });
});
