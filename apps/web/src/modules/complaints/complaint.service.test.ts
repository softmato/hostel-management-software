import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  complaintAttachmentCreate: vi.fn(),
  complaintAttachmentFind: vi.fn(),
  complaintCreate: vi.fn(),
  complaintAggregate: vi.fn(),
  complaintCountDocuments: vi.fn(),
  complaintFind: vi.fn(),
  complaintFindOne: vi.fn(),
  complaintFindOneAndUpdate: vi.fn(),
  complaintUpdateCreate: vi.fn(),
  complaintUpdateFind: vi.fn(),
  connectToDatabase: vi.fn(),
  getOperationsConfig: vi.fn(),
  notifyAdminsOfNewComplaint: vi.fn(),
  notifyResidentOfComplaintReply: vi.fn(),
  notifyResidentOfComplaintStatus: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: {
    create: serviceMocks.auditCreate,
  },
}));

vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: {
    aggregate: serviceMocks.complaintAggregate,
    countDocuments: serviceMocks.complaintCountDocuments,
    create: serviceMocks.complaintCreate,
    find: serviceMocks.complaintFind,
    findOne: serviceMocks.complaintFindOne,
    findOneAndUpdate: serviceMocks.complaintFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/ComplaintAttachment", () => ({
  ComplaintAttachmentModel: {
    create: serviceMocks.complaintAttachmentCreate,
    find: serviceMocks.complaintAttachmentFind,
  },
}));

vi.mock("@hostel/db/models/ComplaintUpdate", () => ({
  ComplaintUpdateModel: {
    create: serviceMocks.complaintUpdateCreate,
    find: serviceMocks.complaintUpdateFind,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    findOne: serviceMocks.residentFindOne,
  },
}));

vi.mock("@/modules/platform-config/operations-config", () => ({
  getOperationsConfig: serviceMocks.getOperationsConfig,
}));

vi.mock("@/modules/complaints/complaint-notify", () => ({
  notifyAdminsOfNewComplaint: serviceMocks.notifyAdminsOfNewComplaint,
  notifyResidentOfComplaintReply: serviceMocks.notifyResidentOfComplaintReply,
  notifyResidentOfComplaintStatus: serviceMocks.notifyResidentOfComplaintStatus,
}));

import {
  confirmComplaintResolution,
  createComplaint,
  listAdminComplaints,
  updateComplaintStatus,
} from "@/modules/complaints/complaint.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0c1";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0c2";
const residentId = "64f0f0f0f0f0f0f0f0f0f0c3";
const userId = "64f0f0f0f0f0f0f0f0f0f0c4";
const roomId = "64f0f0f0f0f0f0f0f0f0f0c5";
const bedId = "64f0f0f0f0f0f0f0f0f0f0c6";
const complaintId = "64f0f0f0f0f0f0f0f0f0f0c7";
const attachmentId = "64f0f0f0f0f0f0f0f0f0f0c8";
const updateId = "64f0f0f0f0f0f0f0f0f0f0c9";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId,
};

const residentPrincipal = {
  hostelIds: [hostelId],
  role: Role.RESIDENT,
  sessionId: "session-2",
  userId,
};

function objectId(value: string) {
  return new Types.ObjectId(value);
}

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function residentRecord() {
  return {
    _id: objectId(residentId),
    bedId: objectId(bedId),
    depositAmount: 5000,
    firstName: "Asha",
    hostelId: objectId(hostelId),
    lastName: "Rai",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomId: objectId(roomId),
    status: "ACTIVE",
    userId: objectId(userId),
  };
}

function complaintRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(complaintId),
    category: "ROOM",
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    description: "The room lock is damaged.",
    hostelId: objectId(hostelId),
    isAnonymous: false,
    residentId: objectId(residentId),
    slaDueAt: new Date("2030-01-04T00:00:00.000Z"),
    status: "PENDING",
    title: "Broken lock",
    ...overrides,
  };
}

function attachmentRecord() {
  return {
    _id: objectId(attachmentId),
    complaintId: objectId(complaintId),
    fileAssetId: "asset-1",
    hostelId: objectId(hostelId),
    uploadedAt: new Date("2030-01-01T00:00:00.000Z"),
    uploadedBy: objectId(userId),
  };
}

function updateRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(updateId),
    actorId: objectId(userId),
    actorRole: Role.HOSTEL_ADMIN,
    complaintId: objectId(complaintId),
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    hostelId: objectId(hostelId),
    type: "STATUS_CHANGE",
    ...overrides,
  };
}

describe("complaint services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getOperationsConfig.mockResolvedValue({ complaintSlaHours: 72 });
    // Summary counts come from the database, not from the page of rows.
    serviceMocks.complaintAggregate.mockResolvedValue([]);
    serviceMocks.complaintCountDocuments.mockResolvedValue(0);
  });

  it("creates resident complaints with attachments, timeline, and audit log", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(leanResult(residentRecord()));
    serviceMocks.complaintCreate.mockResolvedValueOnce(
      complaintRecord({ isAnonymous: true }),
    );
    serviceMocks.complaintAttachmentCreate.mockResolvedValueOnce(attachmentRecord());
    serviceMocks.complaintUpdateCreate.mockResolvedValueOnce(
      updateRecord({ actorRole: Role.RESIDENT, type: "CREATED" }),
    );

    const result = await createComplaint(
      {
        attachmentAssetIds: ["asset-1"],
        category: "ROOM",
        description: "The room lock is damaged.",
        isAnonymous: true,
        title: "Broken lock",
      },
      residentPrincipal,
    );

    expect(result.complaint.isAnonymous).toBe(true);
    expect(result.complaint.attachments).toHaveLength(1);
    expect(serviceMocks.complaintCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        hostelId: objectId(hostelId),
        residentId: objectId(residentId),
        status: "PENDING",
      }),
    );
    expect(serviceMocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "COMPLAINT_CREATED" }),
    );
  });

  it("enforces admin tenant isolation", async () => {
    await expect(
      listAdminComplaints({ hostelId: otherHostelId }, staffPrincipal),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", status: 404 });
  });

  it("hides anonymous resident identity from admin complaint lists", async () => {
    serviceMocks.complaintFind.mockReturnValueOnce(
      queryResult([
        complaintRecord({ isAnonymous: true }),
        complaintRecord({
          _id: objectId("64f0f0f0f0f0f0f0f0f0f0ca"),
          isAnonymous: false,
          status: "RESOLVED",
        }),
      ]),
    );
    serviceMocks.complaintAttachmentFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.complaintUpdateFind.mockReturnValueOnce(queryResult([]));
    // Deliberately larger than the two rows above: the summary must describe
    // the whole filter, not the page that was returned.
    serviceMocks.complaintAggregate.mockResolvedValueOnce([
      { _id: "PENDING", count: 7 },
      { _id: "RESOLVED", count: 4 },
    ]);
    // Two calls, in order: the pagination total, then the overdue count.
    serviceMocks.complaintCountDocuments
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(2);

    const result = await listAdminComplaints({}, staffPrincipal);

    expect(result.complaints[0].residentId).toBeNull();
    expect(result.complaints[1].residentId).toBe(residentId);
    expect(result.complaints).toHaveLength(2);
    expect(result.pagination.total).toBe(11);
    expect(result.summary.total).toBe(11);
    expect(result.summary.pending).toBe(7);
    expect(result.summary.overdue).toBe(2);
  });

  it("updates complaint status inside the admin hostel scope", async () => {
    serviceMocks.complaintFindOne.mockReturnValueOnce(
      leanResult(complaintRecord({ status: "PENDING" })),
    );
    serviceMocks.complaintFindOneAndUpdate.mockReturnValueOnce(
      leanResult(
        complaintRecord({
          resolvedAt: new Date("2030-01-02T00:00:00.000Z"),
          status: "RESOLVED",
        }),
      ),
    );
    serviceMocks.complaintUpdateCreate.mockResolvedValueOnce(
      updateRecord({
        nextStatus: "RESOLVED",
        previousStatus: "PENDING",
      }),
    );

    const result = await updateComplaintStatus(
      complaintId,
      { response: "Fixed by maintenance.", status: "RESOLVED" },
      staffPrincipal,
    );

    expect(result.complaint.status).toBe("RESOLVED");
    expect(serviceMocks.complaintFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ hostelId: { $in: [objectId(hostelId)] } }),
    );
    expect(serviceMocks.complaintUpdateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        nextStatus: "RESOLVED",
        previousStatus: "PENDING",
        type: "STATUS_CHANGE",
      }),
    );
  });

  it("allows residents to confirm only their own resolved complaints", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(leanResult(residentRecord()));
    serviceMocks.complaintFindOne.mockReturnValueOnce(
      leanResult(complaintRecord({ status: "IN_PROGRESS" })),
    );

    await expect(
      confirmComplaintResolution(complaintId, {}, residentPrincipal),
    ).rejects.toMatchObject({
      errorCode: "COMPLAINT_NOT_RESOLVED",
      status: 409,
    });

    serviceMocks.residentFindOne.mockReturnValueOnce(leanResult(residentRecord()));
    serviceMocks.complaintFindOne.mockReturnValueOnce(
      leanResult(complaintRecord({ status: "RESOLVED" })),
    );
    serviceMocks.complaintFindOneAndUpdate.mockReturnValueOnce(
      leanResult(
        complaintRecord({
          confirmedAt: new Date("2030-01-03T00:00:00.000Z"),
          status: "RESOLVED",
        }),
      ),
    );
    serviceMocks.complaintUpdateCreate.mockResolvedValueOnce(
      updateRecord({ actorRole: Role.RESIDENT, type: "RESIDENT_CONFIRMATION" }),
    );

    const result = await confirmComplaintResolution(
      complaintId,
      { note: "Looks good now." },
      residentPrincipal,
    );

    expect(result.complaint.confirmedAt).toBe("2030-01-03T00:00:00.000Z");
    expect(serviceMocks.complaintFindOne).toHaveBeenLastCalledWith({
      _id: objectId(complaintId),
      hostelId: objectId(hostelId),
      residentId: objectId(residentId),
    });
  });
});
