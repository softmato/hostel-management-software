import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { ComplaintModel } from "@hostel/db/models/Complaint";
import { HostelModel } from "@hostel/db/models/Hostel";
import { PaymentModel } from "@hostel/db/models/Payment";
import { ResidentModel } from "@hostel/db/models/Resident";
import type {
  hostelAdminReportExportSchema,
  platformReportExportSchema,
} from "@/modules/reports/report.validation";

type PlatformReportExportInput = z.infer<typeof platformReportExportSchema>;
type HostelAdminReportExportInput = z.infer<typeof hostelAdminReportExportSchema>;

export type ReportExport = {
  columns: Array<{ key: string; label: string }>;
  filenamePrefix: string;
  rows: Array<Record<string, unknown>>;
};

export class ReportExportError extends Error {
  constructor(
    message: string,
    public errorCode = "REPORT_EXPORT_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Exports are aggregates, never row dumps: a CSV of every resident would put
 * names and phone numbers in a downloaded file for no reporting benefit. Each
 * report below groups first and exports the grouped counts.
 */
const EXPORT_ROW_CAP = 5000;

function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new ReportExportError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

async function hostelNamesByIdFor(ids: Types.ObjectId[]) {
  const hostels = await HostelModel.find({ _id: { $in: ids } })
    .select("name")
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();

  return new Map(hostels.map((hostel) => [hostel._id.toString(), hostel.name]));
}

async function hostelsByStatus(): Promise<ReportExport> {
  const rows = await HostelModel.aggregate<{ _id: string; count: number }>([
    { $match: { isDeleted: false } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return {
    columns: [
      { key: "status", label: "Status" },
      { key: "count", label: "Hostels" },
    ],
    filenamePrefix: "hostels-by-status",
    rows: rows.map((row) => ({ count: row.count, status: row._id ?? "UNKNOWN" })),
  };
}

async function residentsByStatus(): Promise<ReportExport> {
  const rows = await ResidentModel.aggregate<{
    _id: { hostelId: Types.ObjectId; status: string };
    count: number;
  }>([
    { $match: { isDeleted: false } },
    { $group: { _id: { hostelId: "$hostelId", status: "$status" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: EXPORT_ROW_CAP },
  ]);
  const names = await hostelNamesByIdFor(rows.map((row) => row._id.hostelId));

  return {
    columns: [
      { key: "hostel", label: "Hostel" },
      { key: "status", label: "Status" },
      { key: "count", label: "Residents" },
    ],
    filenamePrefix: "residents-by-status",
    rows: rows.map((row) => ({
      count: row.count,
      hostel: names.get(row._id.hostelId.toString()) ?? "Unknown hostel",
      status: row._id.status ?? "UNKNOWN",
    })),
  };
}

/** Payment volume: what was billed vs what residents actually settled. */
async function paymentVolume(): Promise<ReportExport> {
  const rows = await PaymentModel.aggregate<{
    _id: { hostelId: Types.ObjectId; month: string };
    dueAmount: number;
    paidAmount: number;
    payments: number;
  }>([
    {
      $group: {
        _id: { hostelId: "$hostelId", month: "$month" },
        dueAmount: { $sum: "$dueAmount" },
        paidAmount: { $sum: "$paidAmount" },
        payments: { $sum: 1 },
      },
    },
    { $sort: { "_id.month": -1 } },
    { $limit: EXPORT_ROW_CAP },
  ]);
  const names = await hostelNamesByIdFor(rows.map((row) => row._id.hostelId));

  return {
    columns: [
      { key: "month", label: "Month" },
      { key: "hostel", label: "Hostel" },
      { key: "payments", label: "Payment records" },
      { key: "dueAmount", label: "Billed (NPR)" },
      { key: "paidAmount", label: "Collected (NPR)" },
      { key: "collectionRatePercent", label: "Collection rate (%)" },
    ],
    filenamePrefix: "payment-volume",
    rows: rows.map((row) => ({
      collectionRatePercent:
        row.dueAmount > 0 ? ((row.paidAmount / row.dueAmount) * 100).toFixed(1) : "0.0",
      dueAmount: row.dueAmount,
      hostel: names.get(row._id.hostelId.toString()) ?? "Unknown hostel",
      month: row._id.month,
      paidAmount: row.paidAmount,
      payments: row.payments,
    })),
  };
}

async function complaintVolume(): Promise<ReportExport> {
  const rows = await ComplaintModel.aggregate<{
    _id: { hostelId: Types.ObjectId; status: string };
    count: number;
  }>([
    { $group: { _id: { hostelId: "$hostelId", status: "$status" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: EXPORT_ROW_CAP },
  ]);
  const names = await hostelNamesByIdFor(rows.map((row) => row._id.hostelId));

  return {
    columns: [
      { key: "hostel", label: "Hostel" },
      { key: "status", label: "Status" },
      { key: "count", label: "Complaints" },
    ],
    filenamePrefix: "complaint-volume",
    rows: rows.map((row) => ({
      count: row.count,
      hostel: names.get(row._id.hostelId.toString()) ?? "Unknown hostel",
      status: row._id.status ?? "UNKNOWN",
    })),
  };
}

export async function buildPlatformReportExport(
  input: PlatformReportExportInput,
): Promise<ReportExport> {
  await connectToDatabase();

  switch (input.report) {
    case "hostels":
      return hostelsByStatus();
    case "residents":
      return residentsByStatus();
    case "payments":
      return paymentVolume();
    case "complaints":
      return complaintVolume();
  }
}

/* -------------------------------------------------------------------------- */
/* Hostel admin                                                               */
/* -------------------------------------------------------------------------- */

function scopedHostelIds(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return [normalizeObjectId(requestedHostelId, "hostel id")];
  }

  return principal.hostelIds.map((id) => normalizeObjectId(id, "hostel id"));
}

export async function buildHostelAdminReportExport(
  input: HostelAdminReportExportInput,
  principal: ApiPrincipal,
): Promise<ReportExport> {
  await connectToDatabase();

  const hostelIds = scopedHostelIds(principal, input.hostelId);

  if (hostelIds.length === 0) {
    throw new ReportExportError(
      "This account is not linked to a hostel.",
      "HOSTEL_SCOPE_REQUIRED",
      422,
    );
  }

  const scope = { hostelId: { $in: hostelIds } };

  if (input.report === "residents") {
    // Resident count over time — grouped by move-in month, never per person.
    const rows = await ResidentModel.aggregate<{ _id: string; count: number }>([
      { $match: { ...scope, isDeleted: false } },
      {
        $group: {
          _id: { $dateToString: { date: "$moveInDate", format: "%Y-%m" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: EXPORT_ROW_CAP },
    ]);

    return {
      columns: [
        { key: "month", label: "Move-in month" },
        { key: "count", label: "Residents" },
      ],
      filenamePrefix: "residents-over-time",
      rows: rows.map((row) => ({ count: row.count, month: row._id ?? "Unknown" })),
    };
  }

  if (input.report === "payments") {
    const rows = await PaymentModel.aggregate<{
      _id: string;
      dueAmount: number;
      paidAmount: number;
      payments: number;
    }>([
      { $match: scope },
      {
        $group: {
          _id: "$month",
          dueAmount: { $sum: "$dueAmount" },
          paidAmount: { $sum: "$paidAmount" },
          payments: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: EXPORT_ROW_CAP },
    ]);

    return {
      columns: [
        { key: "month", label: "Month" },
        { key: "payments", label: "Payment records" },
        { key: "dueAmount", label: "Billed (NPR)" },
        { key: "paidAmount", label: "Collected (NPR)" },
        { key: "collectionRatePercent", label: "Collection rate (%)" },
      ],
      filenamePrefix: "payment-collection",
      rows: rows.map((row) => ({
        collectionRatePercent:
          row.dueAmount > 0 ? ((row.paidAmount / row.dueAmount) * 100).toFixed(1) : "0.0",
        dueAmount: row.dueAmount,
        month: row._id,
        paidAmount: row.paidAmount,
        payments: row.payments,
      })),
    };
  }

  if (input.report === "complaints") {
    // Resolution time in days, so slow categories stand out at a glance.
    const rows = await ComplaintModel.aggregate<{
      _id: { category: string; status: string };
      avgResolutionMs: number | null;
      count: number;
    }>([
      { $match: scope },
      {
        $group: {
          _id: { category: "$category", status: "$status" },
          avgResolutionMs: {
            // Unresolved complaints contribute null, which $avg ignores —
            // otherwise an open ticket would read as "resolved in 0 days".
            $avg: {
              $cond: [
                { $ne: ["$resolvedAt", null] },
                { $subtract: ["$resolvedAt", "$createdAt"] },
                null,
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: EXPORT_ROW_CAP },
    ]);

    return {
      columns: [
        { key: "category", label: "Category" },
        { key: "status", label: "Status" },
        { key: "count", label: "Complaints" },
        { key: "avgResolutionDays", label: "Avg resolution (days)" },
      ],
      filenamePrefix: "complaint-resolution",
      rows: rows.map((row) => ({
        avgResolutionDays: row.avgResolutionMs
          ? (row.avgResolutionMs / 86_400_000).toFixed(1)
          : "—",
        category: row._id.category ?? "UNKNOWN",
        count: row.count,
        status: row._id.status ?? "UNKNOWN",
      })),
    };
  }

  // Occupancy: vacancy is a running count on each hostel's room configurations.
  const hostels = await HostelModel.find({ _id: { $in: hostelIds }, isDeleted: false })
    .select("name roomConfigurations")
    .lean<
      Array<{
        _id: Types.ObjectId;
        name: string;
        roomConfigurations?: Array<{
          bedsPerRoom?: number;
          rooms?: number;
          roomType?: string;
          vacantBeds?: number;
        }>;
      }>
    >();

  return {
    columns: [
      { key: "hostel", label: "Hostel" },
      { key: "roomType", label: "Room type" },
      { key: "totalBeds", label: "Total beds" },
      { key: "occupiedBeds", label: "Occupied beds" },
      { key: "occupancyRatePercent", label: "Occupancy rate (%)" },
    ],
    filenamePrefix: "room-occupancy",
    rows: hostels.flatMap((hostel) =>
      (hostel.roomConfigurations ?? []).map((config) => {
        // Beds are not documents; each room type carries rooms × bedsPerRoom
        // with a running vacancy counter, same as the occupancy report.
        const totalBeds = (config.bedsPerRoom ?? 0) * (config.rooms ?? 0);
        const occupiedBeds = Math.max(totalBeds - (config.vacantBeds ?? 0), 0);

        return {
          hostel: hostel.name,
          occupancyRatePercent:
            totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : "0.0",
          occupiedBeds,
          roomType: config.roomType ?? "Unknown",
          totalBeds,
        };
      }),
    ),
  };
}
