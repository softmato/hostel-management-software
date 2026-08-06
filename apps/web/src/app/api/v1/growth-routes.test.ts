import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  addMaintenanceComment: vi.fn(),
  approveServiceProvider: vi.fn(),
  comparePublicHostels: vi.fn(),
  confirmReferralJoined: vi.fn(),
  createMaintenanceRequest: vi.fn(),
  createReferredInquiry: vi.fn(),
  getApprovedServiceProviderForHostel: vi.fn(),
  getHostelAdminComplaintsReport: vi.fn(),
  getHostelAdminDashboardReport: vi.fn(),
  getHostelAdminMaintenanceReport: vi.fn(),
  getHostelAdminPaymentsReport: vi.fn(),
  getPlatformDashboardReport: vi.fn(),
  getResidentReferral: vi.fn(),
  hideServiceProvider: vi.fn(),
  listApprovedServiceProvidersForHostel: vi.fn(),
  listHostelAdminReferrals: vi.fn(),
  listListingFlags: vi.fn(),
  listMaintenanceRequests: vi.fn(),
  listPlatformServiceProviders: vi.fn(),
  loadApiPrincipal: vi.fn(),
  requireApiPrincipal: vi.fn(),
  registerPublicServiceProvider: vi.fn(),
  rejectServiceProvider: vi.fn(),
  requireHostelCapability: vi.fn(),
  requireHostelStaffPrincipal: vi.fn(),
  requirePlatformPrincipal: vi.fn(),
  requireResidentPrincipal: vi.fn(),
  resolveListingFlag: vi.fn(),
  runDuplicateCheck: vi.fn(),
  updateMaintenanceRequestStatus: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  loadApiPrincipal: routeMocks.loadApiPrincipal,
  requireApiPrincipal: routeMocks.requireApiPrincipal,
  requireHostelCapability: routeMocks.requireHostelCapability,
  requireHostelStaffPrincipal: routeMocks.requireHostelStaffPrincipal,
  requirePlatformPrincipal: routeMocks.requirePlatformPrincipal,
  requireResidentPrincipal: routeMocks.requireResidentPrincipal,
}));

vi.mock("@/modules/service-providers/service-provider.service", () => ({
  approveServiceProvider: routeMocks.approveServiceProvider,
  getApprovedServiceProviderForHostel: routeMocks.getApprovedServiceProviderForHostel,
  hideServiceProvider: routeMocks.hideServiceProvider,
  listApprovedServiceProvidersForHostel: routeMocks.listApprovedServiceProvidersForHostel,
  listPlatformServiceProviders: routeMocks.listPlatformServiceProviders,
  registerPublicServiceProvider: routeMocks.registerPublicServiceProvider,
  rejectServiceProvider: routeMocks.rejectServiceProvider,
}));

vi.mock("@/modules/maintenance/maintenance.service", () => ({
  addMaintenanceComment: routeMocks.addMaintenanceComment,
  createMaintenanceRequest: routeMocks.createMaintenanceRequest,
  listMaintenanceRequests: routeMocks.listMaintenanceRequests,
  updateMaintenanceRequestStatus: routeMocks.updateMaintenanceRequestStatus,
}));

vi.mock("@/modules/hostels/hostel.service", () => ({
  comparePublicHostels: routeMocks.comparePublicHostels,
}));

vi.mock("@/modules/referrals/referral.service", () => ({
  confirmReferralJoined: routeMocks.confirmReferralJoined,
  createReferredInquiry: routeMocks.createReferredInquiry,
  getResidentReferral: routeMocks.getResidentReferral,
  listHostelAdminReferrals: routeMocks.listHostelAdminReferrals,
}));

vi.mock("@/modules/listing-flags/listing-flag.service", () => ({
  listListingFlags: routeMocks.listListingFlags,
  resolveListingFlag: routeMocks.resolveListingFlag,
  runDuplicateCheck: routeMocks.runDuplicateCheck,
}));

vi.mock("@/modules/reports/report.service", () => ({
  getHostelAdminComplaintsReport: routeMocks.getHostelAdminComplaintsReport,
  getHostelAdminDashboardReport: routeMocks.getHostelAdminDashboardReport,
  getHostelAdminMaintenanceReport: routeMocks.getHostelAdminMaintenanceReport,
  getHostelAdminPaymentsReport: routeMocks.getHostelAdminPaymentsReport,
  getPlatformDashboardReport: routeMocks.getPlatformDashboardReport,
}));

import * as hostelAdminMaintenanceRoute from "@/app/api/v1/hostel-admin/maintenance/requests/route";
import * as hostelAdminMaintenanceCommentRoute from "@/app/api/v1/hostel-admin/maintenance/requests/[id]/comment/route";
import * as hostelAdminMaintenanceStatusRoute from "@/app/api/v1/hostel-admin/maintenance/requests/[id]/status/route";
import * as hostelAdminReferralsRoute from "@/app/api/v1/hostel-admin/referrals/route";
import * as hostelAdminReferralConfirmRoute from "@/app/api/v1/hostel-admin/referrals/[id]/confirm/route";
import * as hostelAdminReportsComplaintsRoute from "@/app/api/v1/hostel-admin/reports/complaints/route";
import * as hostelAdminReportsDashboardRoute from "@/app/api/v1/hostel-admin/reports/dashboard/route";
import * as hostelAdminReportsMaintenanceRoute from "@/app/api/v1/hostel-admin/reports/maintenance/route";
import * as hostelAdminReportsPaymentsRoute from "@/app/api/v1/hostel-admin/reports/payments/route";
import * as hostelAdminServiceProviderDetailRoute from "@/app/api/v1/hostel-admin/service-providers/[id]/route";
import * as hostelAdminServiceProvidersRoute from "@/app/api/v1/hostel-admin/service-providers/route";
import * as platformListingFlagResolveRoute from "@/app/api/v1/platform/listing-flags/[id]/resolve/route";
import * as platformListingFlagsRoute from "@/app/api/v1/platform/listing-flags/route";
import * as platformReportsRoute from "@/app/api/v1/platform/reports/dashboard/route";
import * as platformProviderApproveRoute from "@/app/api/v1/platform/service-providers/[id]/approve/route";
import * as platformProviderHideRoute from "@/app/api/v1/platform/service-providers/[id]/hide/route";
import * as platformProviderRejectRoute from "@/app/api/v1/platform/service-providers/[id]/reject/route";
import * as platformServiceProvidersRoute from "@/app/api/v1/platform/service-providers/route";
import * as publicCompareRoute from "@/app/api/v1/public/hostels/compare/route";
import * as publicReferralInquiryRoute from "@/app/api/v1/public/inquiries/with-referral/route";
import * as publicServiceProviderRegisterRoute from "@/app/api/v1/public/service-providers/register/route";
import * as residentReferralRoute from "@/app/api/v1/resident/referral/route";
import * as runDuplicateCheckRoute from "@/app/api/v1/platform/hostels/[id]/run-duplicate-check/route";
import { Role } from "@/lib/roles";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0d1";
const userId = "64f0f0f0f0f0f0f0f0f0f0d2";
const entityId = "64f0f0f0f0f0f0f0f0f0f0d3";
const secondId = "64f0f0f0f0f0f0f0f0f0f0d4";

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

const platformPrincipal = {
  hostelIds: [],
  role: Role.SUPERADMIN,
  sessionId: "session-3",
  userId,
};

function routeContext<T extends Record<string, string>>(params: T) {
  return {
    params: Promise.resolve(params),
  };
}

function request(
  path: string,
  options: {
    body?: unknown;
    method?: "GET" | "POST" | "PATCH";
  } = {},
) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: options.body ? { "content-type": "application/json" } : {},
    method: options.method ?? "GET",
  });
}

describe("growth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.loadApiPrincipal.mockResolvedValue(null);
    // Provider registration needs a session — the account link is what the
    // applicant's own status lookup and the ID card re-issue hang off.
    routeMocks.requireApiPrincipal.mockResolvedValue({
      hostelIds: [],
      role: "PUBLIC",
      userId: secondId,
    });
    routeMocks.requireHostelStaffPrincipal.mockResolvedValue(staffPrincipal);
    routeMocks.requireHostelCapability.mockResolvedValue(staffPrincipal);
    routeMocks.requirePlatformPrincipal.mockResolvedValue(platformPrincipal);
    routeMocks.requireResidentPrincipal.mockResolvedValue(residentPrincipal);
  });

  it("handles service provider registration and moderation", async () => {
    routeMocks.registerPublicServiceProvider.mockResolvedValue({
      provider: { id: entityId },
    });
    routeMocks.listPlatformServiceProviders.mockResolvedValue({ providers: [] });
    routeMocks.approveServiceProvider.mockResolvedValue({ provider: { id: entityId } });
    routeMocks.rejectServiceProvider.mockResolvedValue({ provider: { id: entityId } });
    routeMocks.hideServiceProvider.mockResolvedValue({ provider: { id: entityId } });
    routeMocks.listApprovedServiceProvidersForHostel.mockResolvedValue({
      providers: [],
    });
    routeMocks.getApprovedServiceProviderForHostel.mockResolvedValue({
      provider: { id: entityId },
    });

    const register = await publicServiceProviderRegisterRoute.POST(
      request("/api/v1/public/service-providers/register", {
        body: {
          area: "Lalitpur",
          category: "CLEANER",
          fullName: "CleanStay Nepal",
          phone: "9841002300",
        },
        method: "POST",
      }),
    );
    const platformList = await platformServiceProvidersRoute.GET(
      request("/api/v1/platform/service-providers?status=PENDING_APPROVAL"),
    );
    const approve = await platformProviderApproveRoute.PATCH(
      request(`/api/v1/platform/service-providers/${entityId}/approve`, {
        body: {},
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const reject = await platformProviderRejectRoute.PATCH(
      request(`/api/v1/platform/service-providers/${entityId}/reject`, {
        body: { reason: "Missing document" },
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const hide = await platformProviderHideRoute.PATCH(
      request(`/api/v1/platform/service-providers/${entityId}/hide`, {
        body: {},
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const adminList = await hostelAdminServiceProvidersRoute.GET(
      request("/api/v1/hostel-admin/service-providers?category=CLEANER"),
    );
    const adminDetail = await hostelAdminServiceProviderDetailRoute.GET(
      request(`/api/v1/hostel-admin/service-providers/${entityId}`),
      routeContext({ id: entityId }),
    );

    expect(register.status).toBe(201);
    expect(platformList.status).toBe(200);
    expect(approve.status).toBe(200);
    expect(reject.status).toBe(200);
    expect(hide.status).toBe(200);
    expect(adminList.status).toBe(200);
    expect(adminDetail.status).toBe(200);
    expect(routeMocks.registerPublicServiceProvider).toHaveBeenCalledWith(
      expect.anything(),
      { userId: secondId },
    );
  });

  /**
   * The Google gate on the public form exists so the application belongs to an
   * account: that link drives the applicant's own status lookup, the duplicate
   * check, and the ID card the platform re-issues on approval. If the
   * submitting account is not carried into the service, all three lose their
   * target — so it is asserted rather than assumed.
   */
  it("links a public provider registration to the submitting account", async () => {
    routeMocks.registerPublicServiceProvider.mockResolvedValue({
      provider: { id: entityId },
    });

    const register = await publicServiceProviderRegisterRoute.POST(
      request("/api/v1/public/service-providers/register", {
        body: {
          area: "Thamel",
          category: "PLUMBER",
          fullName: "Siddhant Yadav",
          phone: "9841002300",
        },
        method: "POST",
      }),
    );

    expect(register.status).toBe(201);
    expect(routeMocks.registerPublicServiceProvider).toHaveBeenCalledWith(
      expect.objectContaining({ area: "Thamel" }),
      { userId: secondId },
    );
  });

  it("refuses an unauthenticated provider registration", async () => {
    routeMocks.requireApiPrincipal.mockRejectedValue(
      Object.assign(new Error("Authentication required."), {
        errorCode: "UNAUTHENTICATED",
        status: 401,
      }),
    );

    const register = await publicServiceProviderRegisterRoute.POST(
      request("/api/v1/public/service-providers/register", {
        body: {
          area: "Thamel",
          category: "PLUMBER",
          fullName: "Siddhant Yadav",
          phone: "9841002300",
        },
        method: "POST",
      }),
    );

    expect(register.status).not.toBe(201);
    expect(routeMocks.registerPublicServiceProvider).not.toHaveBeenCalled();
  });

  it("handles maintenance requests", async () => {
    routeMocks.listMaintenanceRequests.mockResolvedValue({ requests: [] });
    routeMocks.createMaintenanceRequest.mockResolvedValue({ request: { id: entityId } });
    routeMocks.updateMaintenanceRequestStatus.mockResolvedValue({
      request: { id: entityId, status: "COMPLETED" },
    });
    routeMocks.addMaintenanceComment.mockResolvedValue({ comment: { id: secondId } });

    const list = await hostelAdminMaintenanceRoute.GET(
      request("/api/v1/hostel-admin/maintenance/requests?status=PENDING"),
    );
    const create = await hostelAdminMaintenanceRoute.POST(
      request("/api/v1/hostel-admin/maintenance/requests", {
        body: {
          category: "PLUMBING",
          priority: "HIGH",
          providerId: entityId,
          title: "Tap leakage",
        },
        method: "POST",
      }),
    );
    const status = await hostelAdminMaintenanceStatusRoute.PATCH(
      request(`/api/v1/hostel-admin/maintenance/requests/${entityId}/status`, {
        body: { note: "Fixed", status: "COMPLETED" },
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const comment = await hostelAdminMaintenanceCommentRoute.POST(
      request(`/api/v1/hostel-admin/maintenance/requests/${entityId}/comment`, {
        body: { message: "Called provider" },
        method: "POST",
      }),
      routeContext({ id: entityId }),
    );

    expect(list.status).toBe(200);
    expect(create.status).toBe(201);
    expect(status.status).toBe(200);
    expect(comment.status).toBe(201);
  });

  it("handles comparison, referrals, flags, and reports", async () => {
    routeMocks.comparePublicHostels.mockResolvedValue({ hostels: [] });
    routeMocks.getResidentReferral.mockResolvedValue({
      referralCode: { code: "HH2300D3" },
      referrals: [],
    });
    routeMocks.createReferredInquiry.mockResolvedValue({ referral: { id: entityId } });
    routeMocks.listHostelAdminReferrals.mockResolvedValue({ referrals: [] });
    routeMocks.confirmReferralJoined.mockResolvedValue({ referral: { id: entityId } });
    routeMocks.listListingFlags.mockResolvedValue({ flags: [] });
    routeMocks.runDuplicateCheck.mockResolvedValue({ result: { id: entityId } });
    routeMocks.resolveListingFlag.mockResolvedValue({ flag: { id: entityId } });
    routeMocks.getPlatformDashboardReport.mockResolvedValue({ report: {} });
    routeMocks.getHostelAdminDashboardReport.mockResolvedValue({ report: {} });
    routeMocks.getHostelAdminPaymentsReport.mockResolvedValue({ report: {} });
    routeMocks.getHostelAdminComplaintsReport.mockResolvedValue({ report: {} });
    routeMocks.getHostelAdminMaintenanceReport.mockResolvedValue({ report: {} });

    const compare = await publicCompareRoute.GET(
      request(`/api/v1/public/hostels/compare?ids=${hostelId},${secondId}`),
    );
    const residentReferral = await residentReferralRoute.GET(
      request("/api/v1/resident/referral"),
    );
    const referralInquiry = await publicReferralInquiryRoute.POST(
      request("/api/v1/public/inquiries/with-referral", {
        body: {
          name: "New Student",
          phone: "9841002301",
          referralCode: "HH2300D3",
        },
        method: "POST",
      }),
    );
    const adminReferrals = await hostelAdminReferralsRoute.GET(
      request("/api/v1/hostel-admin/referrals"),
    );
    const confirmReferral = await hostelAdminReferralConfirmRoute.PATCH(
      request(`/api/v1/hostel-admin/referrals/${entityId}/confirm`, {
        body: { rewardAmount: 500 },
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const flags = await platformListingFlagsRoute.GET(
      request("/api/v1/platform/listing-flags?status=OPEN"),
    );
    const duplicateCheck = await runDuplicateCheckRoute.POST(
      request(`/api/v1/platform/hostels/${hostelId}/run-duplicate-check`, {
        body: {},
        method: "POST",
      }),
      routeContext({ id: hostelId }),
    );
    const resolveFlag = await platformListingFlagResolveRoute.PATCH(
      request(`/api/v1/platform/listing-flags/${entityId}/resolve`, {
        body: { resolutionNote: "Same owner confirmed.", status: "RESOLVED" },
        method: "PATCH",
      }),
      routeContext({ id: entityId }),
    );
    const platformReport = await platformReportsRoute.GET(
      request("/api/v1/platform/reports/dashboard"),
    );
    const adminDashboard = await hostelAdminReportsDashboardRoute.GET(
      request("/api/v1/hostel-admin/reports/dashboard"),
    );
    const adminPayments = await hostelAdminReportsPaymentsRoute.GET(
      request("/api/v1/hostel-admin/reports/payments?month=2026-06"),
    );
    const adminComplaints = await hostelAdminReportsComplaintsRoute.GET(
      request("/api/v1/hostel-admin/reports/complaints"),
    );
    const adminMaintenance = await hostelAdminReportsMaintenanceRoute.GET(
      request("/api/v1/hostel-admin/reports/maintenance"),
    );

    expect(compare.status).toBe(200);
    expect(residentReferral.status).toBe(200);
    expect(referralInquiry.status).toBe(201);
    expect(adminReferrals.status).toBe(200);
    expect(confirmReferral.status).toBe(200);
    expect(flags.status).toBe(200);
    expect(duplicateCheck.status).toBe(200);
    expect(resolveFlag.status).toBe(200);
    expect(platformReport.status).toBe(200);
    expect(adminDashboard.status).toBe(200);
    expect(adminPayments.status).toBe(200);
    expect(adminComplaints.status).toBe(200);
    expect(adminMaintenance.status).toBe(200);
  });
});
