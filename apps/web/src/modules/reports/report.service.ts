import { Types, type PipelineStage } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { ComplaintModel } from "@hostel/db/models/Complaint";
import { FoodFeedbackModel } from "@hostel/db/models/FoodFeedback";
import { HostelModel } from "@hostel/db/models/Hostel";
import { InquiryModel } from "@hostel/db/models/Inquiry";
import { ListingFlagModel } from "@hostel/db/models/ListingFlag";
import { MaintenanceRequestModel } from "@hostel/db/models/MaintenanceRequest";
import { NightStatusModel } from "@hostel/db/models/NightStatus";
import { PaymentModel } from "@hostel/db/models/Payment";
import { PaymentProofModel } from "@hostel/db/models/PaymentProof";
import { RatingReviewModel } from "@hostel/db/models/RatingReview";
import { ResidentModel } from "@hostel/db/models/Resident";
import { ServiceProviderModel } from "@hostel/db/models/ServiceProvider";
import { getHostelViewStats } from "@/modules/hostels/hostel-view.service";
import type { reportQuerySchema } from "@/modules/reports/report.validation";

type ReportQuery = z.infer<typeof reportQuerySchema>;

export class ReportServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "REPORT_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new ReportServiceError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value, "hostel id"));
}

function hostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return { hostelId: normalizeObjectId(requestedHostelId, "hostel id") };
  }

  return {
    hostelId: {
      $in: normalizeObjectIds(principal.hostelIds),
    },
  };
}

function startOfMonth(month?: string) {
  if (!month) {
    return null;
  }

  const [year, index] = month.split("-").map(Number);

  if (!year || !index) {
    return null;
  }

  return new Date(Date.UTC(year, index - 1, 1));
}

function endOfMonth(month?: string) {
  const start = startOfMonth(month);

  if (!start) {
    return null;
  }

  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

/**
 * Vacancy is a running count on each hostel's roomConfigurations rather than a
 * collection of bed records, so this sums the per-room-type figures.
 */
async function countVacantBeds(hostelIds: Types.ObjectId[]) {
  const hostels = await HostelModel.find({
    _id: { $in: hostelIds },
    isDeleted: false,
  })
    .select("roomConfigurations")
    .lean<Array<{ roomConfigurations?: Array<{ vacantBeds?: number }> }>>();

  return hostels.reduce(
    (total, hostel) =>
      total +
      (hostel.roomConfigurations ?? []).reduce(
        (sum, config) => sum + (config.vacantBeds ?? 0),
        0,
      ),
    0,
  );
}

async function sumPayments(filter: Record<string, unknown>) {
  const [result] = await PaymentModel.aggregate<{
    dueAmount: number;
    paidAmount: number;
  }>([
    { $match: filter },
    {
      $group: {
        _id: null,
        dueAmount: { $sum: "$dueAmount" },
        paidAmount: { $sum: "$paidAmount" },
      },
    },
  ]);

  return {
    dueAmount: result?.dueAmount ?? 0,
    paidAmount: result?.paidAmount ?? 0,
  };
}

async function countByField(
  model: {
    aggregate: <T>(pipeline: PipelineStage[]) => {
      exec: () => Promise<T[]>;
    };
  },
  filter: Record<string, unknown>,
  field: string,
) {
  const rows = await model
    .aggregate<{
      _id: string;
      count: number;
    }>([
      { $match: filter },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .exec();

  return Object.fromEntries(rows.map((row) => [row._id ?? "UNKNOWN", row.count]));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_WINDOW_DAYS = 30;
const SERIES_BUCKETS = 5;
const SERIES_BUCKET_DAYS = 7;

type CountingModel = {
  countDocuments: (filter: Record<string, unknown>) => Promise<number> | { then: unknown };
};

/**
 * Percent change of "documents created in the last 30 days" against the 30 days
 * before that. Returned as a signed number so the client only formats it — a
 * null `changePercent` means the previous window was empty and a ratio would be
 * meaningless (the client shows the raw delta instead).
 */
async function windowTrend(
  model: CountingModel,
  filter: Record<string, unknown>,
  now: Date,
  dateField = "createdAt",
) {
  const currentStart = new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS);
  const previousStart = new Date(now.getTime() - 2 * TREND_WINDOW_DAYS * DAY_MS);

  const [current, previous] = await Promise.all([
    model.countDocuments({ ...filter, [dateField]: { $gte: currentStart } }) as Promise<number>,
    model.countDocuments({
      ...filter,
      [dateField]: { $gte: previousStart, $lt: currentStart },
    }) as Promise<number>,
  ]);

  return {
    changePercent:
      previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : null,
    current,
    previous,
  };
}

function bucketBoundaries(now: Date) {
  return Array.from({ length: SERIES_BUCKETS }, (_, index) => {
    const end = new Date(now.getTime() - (SERIES_BUCKETS - 1 - index) * SERIES_BUCKET_DAYS * DAY_MS);
    return { end, start: new Date(end.getTime() - SERIES_BUCKET_DAYS * DAY_MS) };
  });
}

/** Weekly counts over the last five weeks, used by the dashboard sparklines. */
async function weeklyCounts(
  model: CountingModel,
  filter: Record<string, unknown>,
  now: Date,
  dateField = "createdAt",
) {
  return Promise.all(
    bucketBoundaries(now).map(
      (bucket) =>
        model.countDocuments({
          ...filter,
          [dateField]: { $gte: bucket.start, $lt: bucket.end },
        }) as Promise<number>,
    ),
  );
}

async function weeklyPaidAmounts(now: Date) {
  const buckets = bucketBoundaries(now);

  return Promise.all(
    buckets.map(async (bucket) => {
      const totals = await sumPayments({
        paidDate: { $gte: bucket.start, $lt: bucket.end },
      });

      return totals.paidAmount;
    }),
  );
}

export async function getPlatformDashboardReport() {
  await connectToDatabase();

  const now = new Date();

  const [
    totalHostels,
    pendingApprovals,
    activeResidents,
    inquiries,
    serviceProviders,
    complaints,
    reviews,
    openListingFlags,
    paymentTotals,
  ] = await Promise.all([
    HostelModel.countDocuments({ isDeleted: false }),
    HostelModel.countDocuments({ isDeleted: false, status: "PENDING_APPROVAL" }),
    ResidentModel.countDocuments({ isDeleted: false, status: "ACTIVE" }),
    InquiryModel.countDocuments({ isDeleted: false }),
    ServiceProviderModel.countDocuments({ isDeleted: false }),
    ComplaintModel.countDocuments({}),
    RatingReviewModel.countDocuments({}),
    ListingFlagModel.countDocuments({ isDeleted: false, status: "OPEN" }),
    sumPayments({}),
  ]);

  const [
    hostelTrend,
    pendingTrend,
    residentTrend,
    inquiryTrend,
    serviceProviderTrend,
    complaintTrend,
    revenueCurrent,
    revenuePrevious,
    hostelSeries,
    inquirySeries,
    revenueSeries,
  ] = await Promise.all([
    windowTrend(HostelModel, { isDeleted: false }, now),
    windowTrend(HostelModel, { isDeleted: false, status: "PENDING_APPROVAL" }, now),
    windowTrend(ResidentModel, { isDeleted: false, status: "ACTIVE" }, now),
    windowTrend(InquiryModel, { isDeleted: false }, now),
    windowTrend(ServiceProviderModel, { isDeleted: false }, now),
    windowTrend(ComplaintModel, {}, now),
    sumPayments({ paidDate: { $gte: new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS) } }),
    sumPayments({
      paidDate: {
        $gte: new Date(now.getTime() - 2 * TREND_WINDOW_DAYS * DAY_MS),
        $lt: new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS),
      },
    }),
    weeklyCounts(HostelModel, { isDeleted: false }, now),
    weeklyCounts(InquiryModel, { isDeleted: false }, now),
    weeklyPaidAmounts(now),
  ]);

  const revenueTrend = {
    changePercent:
      revenuePrevious.paidAmount > 0
        ? Number(
            (
              ((revenueCurrent.paidAmount - revenuePrevious.paidAmount) /
                revenuePrevious.paidAmount) *
              100
            ).toFixed(1),
          )
        : null,
    current: revenueCurrent.paidAmount,
    previous: revenuePrevious.paidAmount,
  };

  return {
    report: {
      activeResidents,
      complaints,
      inquiries,
      openListingFlags,
      outstandingPayments: Math.max(paymentTotals.dueAmount - paymentTotals.paidAmount, 0),
      pendingApprovals,
      // Real ledger roll-up: every payment residents have actually settled.
      // Subscription billing is still outside the pilot schema.
      platformPayments: paymentTotals.paidAmount,
      reviews,
      serviceProviders,
      series: {
        bucketDays: SERIES_BUCKET_DAYS,
        hostels: hostelSeries,
        inquiries: inquirySeries,
        labels: bucketBoundaries(now).map((bucket) => bucket.end.toISOString()),
        revenue: revenueSeries,
      },
      totalHostels,
      trends: {
        activeResidents: residentTrend,
        complaints: complaintTrend,
        inquiries: inquiryTrend,
        pendingApprovals: pendingTrend,
        platformPayments: revenueTrend,
        serviceProviders: serviceProviderTrend,
        totalHostels: hostelTrend,
      },
      windowDays: TREND_WINDOW_DAYS,
    },
  };
}

type PlatformPaymentRecord = {
  _id: Types.ObjectId;
  dueAmount: number;
  dueDate?: Date;
  hostelId: Types.ObjectId;
  month: string;
  paidAmount: number;
  status: string;
};

type PlatformPaymentProofRecord = {
  _id: Types.ObjectId;
  hostelId: Types.ObjectId;
  paymentId: Types.ObjectId;
  proofImageAssetId: string;
  residentId: Types.ObjectId;
  status: string;
  submittedAt?: Date;
  transactionCode?: string;
};

// Read-only, platform-wide roll-up of resident payment records (no hostel
// scoping) for the Platform Owner "Payments" tab. Manual/gateway billing stays
// out of scope; this simply aggregates what admins have already recorded.
export async function getPlatformPaymentsOverview() {
  await connectToDatabase();

  const [totals, statusCounts, pendingProofs, recent, proofs] = await Promise.all([
    sumPayments({}),
    countByField(PaymentModel, {}, "status"),
    PaymentProofModel.countDocuments({ status: "PENDING" }),
    PaymentModel.find({})
      .sort({ createdAt: -1 })
      .limit(25)
      .lean<PlatformPaymentRecord[]>(),
    PaymentProofModel.find({ status: "PENDING" })
      .sort({ submittedAt: -1 })
      .limit(10)
      .lean<PlatformPaymentProofRecord[]>(),
  ]);

  // Resolve hostel names for both the payment rows and the pending proof queue
  // in one query rather than one per row.
  const hostelIds = [
    ...new Set([
      ...recent.map((payment) => payment.hostelId.toString()),
      ...proofs.map((proof) => proof.hostelId.toString()),
    ]),
  ];
  const hostels = await HostelModel.find({ _id: { $in: hostelIds } })
    .select("name")
    .lean<Array<{ _id: Types.ObjectId; name?: string }>>();
  const nameById = new Map(hostels.map((hostel) => [hostel._id.toString(), hostel.name ?? "—"]));

  const proofPayments = await PaymentModel.find({
    _id: { $in: proofs.map((proof) => proof.paymentId) },
  }).lean<PlatformPaymentRecord[]>();
  const paymentById = new Map(
    proofPayments.map((payment) => [payment._id.toString(), payment]),
  );

  return {
    overview: {
      outstanding: Math.max(totals.dueAmount - totals.paidAmount, 0),
      pendingProofs,
      statusCounts,
      totalDue: totals.dueAmount,
      totalPaid: totals.paidAmount,
    },
    proofs: proofs.map((proof) => {
      const payment = paymentById.get(proof.paymentId.toString());

      return {
        amount: payment?.dueAmount ?? 0,
        hostelName: nameById.get(proof.hostelId.toString()) ?? "—",
        id: proof._id.toString(),
        month: payment?.month ?? "—",
        paymentId: proof.paymentId.toString(),
        proofImageAssetId: proof.proofImageAssetId,
        residentId: proof.residentId.toString(),
        status: proof.status,
        submittedAt: proof.submittedAt?.toISOString() ?? null,
        transactionCode: proof.transactionCode ?? "",
      };
    }),
    recent: recent.map((payment) => ({
      dueAmount: payment.dueAmount,
      dueDate: payment.dueDate?.toISOString() ?? null,
      hostelName: nameById.get(payment.hostelId.toString()) ?? "—",
      id: payment._id.toString(),
      month: payment.month,
      paidAmount: payment.paidAmount,
      status: payment.status,
    })),
  };
}

export async function getHostelAdminDashboardReport(
  query: ReportQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const scoped = hostelFilter(principal, query.hostelId);
  const paymentFilter = { ...scoped };
  // hostelFilter yields either `{ hostelId: ObjectId }` or `{ hostelId: { $in } }`;
  // the view stats query needs the plain list either way.
  const scopedHostelIds =
    scoped.hostelId instanceof Types.ObjectId ? [scoped.hostelId] : scoped.hostelId.$in;
  const [
    residents,
    vacantBeds,
    paymentTotals,
    pendingPaymentProofs,
    complaints,
    maintenanceRequests,
    foodFeedback,
    nightStatusSummary,
    viewStats,
  ] = await Promise.all([
    ResidentModel.countDocuments({ ...scoped, isDeleted: false }),
    countVacantBeds(scopedHostelIds),
    sumPayments(paymentFilter),
    PaymentProofModel.countDocuments({ ...scoped, status: "PENDING" }),
    ComplaintModel.countDocuments(scoped),
    MaintenanceRequestModel.countDocuments({ ...scoped, isDeleted: false }),
    FoodFeedbackModel.countDocuments(scoped),
    countByField(NightStatusModel, scoped, "status"),
    getHostelViewStats(scopedHostelIds),
  ]);

  return {
    report: {
      complaints,
      foodFeedback,
      maintenanceRequests,
      monthlyDues: paymentTotals.dueAmount,
      paidAmount: paymentTotals.paidAmount,
      pendingPaymentProofs,
      publicViewsLast30Days: viewStats.publicViewsLast30Days,
      residents,
      totalPublicViews: viewStats.totalPublicViews,
      uniquePublicVisitors: viewStats.uniquePublicVisitors,
      vacantBeds,
      nightStatusSummary,
    },
  };
}

export async function getHostelAdminPaymentsReport(
  query: ReportQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const scoped = hostelFilter(principal, query.hostelId);
  const filter: Record<string, unknown> = { ...scoped };
  const monthStart = startOfMonth(query.month);
  const monthEnd = endOfMonth(query.month);

  if (query.month) {
    filter.month = query.month;
  }

  const proofFilter: Record<string, unknown> = { ...scoped };

  if (monthStart && monthEnd) {
    proofFilter.submittedAt = { $gte: monthStart, $lt: monthEnd };
  }

  const [totals, byStatus, pendingProofs] = await Promise.all([
    sumPayments(filter),
    countByField(PaymentModel, filter, "status"),
    PaymentProofModel.countDocuments({ ...proofFilter, status: "PENDING" }),
  ]);

  return {
    report: {
      byStatus,
      pendingProofs,
      totalDue: totals.dueAmount,
      totalPaid: totals.paidAmount,
    },
  };
}

export async function getHostelAdminComplaintsReport(
  query: ReportQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const scoped = hostelFilter(principal, query.hostelId);

  const [byStatus, byCategory, total] = await Promise.all([
    countByField(ComplaintModel, scoped, "status"),
    countByField(ComplaintModel, scoped, "category"),
    ComplaintModel.countDocuments(scoped),
  ]);

  return {
    report: {
      byCategory,
      byStatus,
      total,
    },
  };
}

export async function getHostelAdminMaintenanceReport(
  query: ReportQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const scoped = {
    ...hostelFilter(principal, query.hostelId),
    isDeleted: false,
  };

  const [byStatus, byCategory, total, completed] = await Promise.all([
    countByField(MaintenanceRequestModel, scoped, "status"),
    countByField(MaintenanceRequestModel, scoped, "category"),
    MaintenanceRequestModel.countDocuments(scoped),
    MaintenanceRequestModel.countDocuments({ ...scoped, status: "COMPLETED" }),
  ]);

  return {
    report: {
      byCategory,
      byStatus,
      completed,
      open: total - completed,
      total,
    },
  };
}
