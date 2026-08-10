import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  activateResident: vi.fn(),
  createNotice: vi.fn(),
  generateActivationCode: vi.fn(),
  getActivationStatus: vi.fn(),
  getResidentDashboard: vi.fn(),
  getResidentProfile: vi.fn(),
  getFoodRoutine: vi.fn(),
  listFoodForResident: vi.fn(),
  resolveAdminHostelId: vi.fn(),
  saveFoodRoutine: vi.fn(),
  listNotices: vi.fn(),
  listNoticesForResident: vi.fn(),
  markNoticeAsRead: vi.fn(),
  regenerateActivationCode: vi.fn(),
  requireApiPrincipal: vi.fn(),
  requireHostelCapability: vi.fn(),
  requireHostelStaffPrincipal: vi.fn(),
  requireResidentPrincipal: vi.fn(),
  submitFoodFeedback: vi.fn(),
  updateNotice: vi.fn(),
  uploadFoodPhoto: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiPrincipal: routeMocks.requireApiPrincipal,
  requireHostelCapability: routeMocks.requireHostelCapability,
  requireHostelStaffPrincipal: routeMocks.requireHostelStaffPrincipal,
  requireResidentPrincipal: routeMocks.requireResidentPrincipal,
}));

vi.mock("@/modules/residents/activation.service", () => ({
  activateResident: routeMocks.activateResident,
  generateActivationCode: routeMocks.generateActivationCode,
  getActivationStatus: routeMocks.getActivationStatus,
  regenerateActivationCode: routeMocks.regenerateActivationCode,
}));

vi.mock("@/modules/residents/resident-dashboard.service", () => ({
  getResidentDashboard: routeMocks.getResidentDashboard,
  getResidentProfile: routeMocks.getResidentProfile,
}));

vi.mock("@/modules/food/food.service", () => ({
  listFoodForResident: routeMocks.listFoodForResident,
  resolveAdminHostelId: routeMocks.resolveAdminHostelId,
  submitFoodFeedback: routeMocks.submitFoodFeedback,
  uploadFoodPhoto: routeMocks.uploadFoodPhoto,
}));

vi.mock("@/modules/food/food-routine.service", () => ({
  getFoodRoutine: routeMocks.getFoodRoutine,
  saveFoodRoutine: routeMocks.saveFoodRoutine,
}));

vi.mock("@/modules/notices/notice.service", () => ({
  createNotice: routeMocks.createNotice,
  listNotices: routeMocks.listNotices,
  listNoticesForResident: routeMocks.listNoticesForResident,
  markNoticeAsRead: routeMocks.markNoticeAsRead,
  updateNotice: routeMocks.updateNotice,
}));

import * as adminActivationRoute from "@/app/api/v1/hostel-admin/residents/[id]/activation-code/route";
import * as residentActivateRoute from "@/app/api/v1/resident/activate/route";
import * as residentActivationStatusRoute from "@/app/api/v1/resident/activation-status/route";
import * as residentDashboardRoute from "@/app/api/v1/resident/dashboard/route";
import * as residentMeRoute from "@/app/api/v1/resident/me/route";
import * as adminFoodPhotosRoute from "@/app/api/v1/hostel-admin/food/photos/route";
import * as adminFoodRoutineRoute from "@/app/api/v1/hostel-admin/food/routine/route";
import * as residentFoodRoute from "@/app/api/v1/resident/food/route";
import * as residentFoodFeedbackRoute from "@/app/api/v1/resident/food/feedback/route";
import * as residentFoodPhotosRoute from "@/app/api/v1/resident/food/photos/route";
import * as adminNoticesRoute from "@/app/api/v1/hostel-admin/notices/route";
import * as adminNoticeDetailRoute from "@/app/api/v1/hostel-admin/notices/[id]/route";
import * as residentNoticesRoute from "@/app/api/v1/resident/notices/route";
import * as residentNoticeReadRoute from "@/app/api/v1/resident/notices/[id]/read/route";
import { Role } from "@/lib/roles";

const staffPrincipal = {
  hostelIds: ["64f0f0f0f0f0f0f0f0f0f0f1"],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0f2",
};

const residentPrincipal = {
  hostelIds: ["64f0f0f0f0f0f0f0f0f0f0f1"],
  role: Role.RESIDENT,
  sessionId: "session-2",
  userId: "64f0f0f0f0f0f0f0f0f0f0f3",
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
    method?: "GET" | "POST" | "PATCH" | "PUT";
    mobile?: boolean;
  } = {},
) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.mobile ? { "x-hostelhub-client": "mobile" } : {}),
    },
    method: options.method ?? "GET",
  });
}

describe("resident daily-use routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireApiPrincipal.mockResolvedValue(residentPrincipal);
    routeMocks.requireHostelStaffPrincipal.mockResolvedValue(staffPrincipal);
    routeMocks.requireHostelCapability.mockResolvedValue(staffPrincipal);
    routeMocks.requireResidentPrincipal.mockResolvedValue(residentPrincipal);
  });

  it("generates activation codes and activates residents with a mobile session", async () => {
    routeMocks.generateActivationCode.mockResolvedValue({
      activation: { code: "ABCD1234", id: "activation-1" },
    });
    routeMocks.activateResident.mockResolvedValue({
      activation: { id: "activation-1", status: "USED" },
      resident: { id: "resident-1", status: "ACTIVE" },
      session: {
        accessToken: "access-next",
        refreshToken: "refresh-next",
        user: { id: residentPrincipal.userId, role: Role.RESIDENT },
      },
    });

    const generateResponse = await adminActivationRoute.POST(
      request("/api/v1/hostel-admin/residents/64f0f0f0f0f0f0f0f0f0f0f4/activation-code", {
        body: { expiresInHours: 24 },
        method: "POST",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f4" }),
    );
    const activateResponse = await residentActivateRoute.POST(
      request("/api/v1/resident/activate", {
        body: { code: "ABCD1234", deviceInfo: { os: "ios" } },
        method: "POST",
        mobile: true,
      }),
    );
    const activatePayload = await activateResponse.json();

    expect(generateResponse.status).toBe(201);
    expect(activateResponse.status).toBe(200);
    expect(activatePayload.data.refreshToken).toBe("refresh-next");
    expect(routeMocks.generateActivationCode).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f4",
      { expiresInHours: 24, sendEmail: true },
      staffPrincipal,
    );
    expect(routeMocks.activateResident).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ABCD1234", deviceInfo: { os: "ios" } }),
      residentPrincipal,
    );
  });

  it("loads activation status, dashboard, and resident profile", async () => {
    routeMocks.getActivationStatus.mockResolvedValue({ isActivated: true });
    routeMocks.getResidentDashboard.mockResolvedValue({ dashboard: { notices: [] } });
    routeMocks.getResidentProfile.mockResolvedValue({ profile: { guardians: [] } });

    const statusResponse = await residentActivationStatusRoute.GET(
      request("/api/v1/resident/activation-status?code=ABCD1234"),
    );
    const dashboardResponse = await residentDashboardRoute.GET(
      request("/api/v1/resident/dashboard"),
    );
    const meResponse = await residentMeRoute.GET(request("/api/v1/resident/me"));

    expect(statusResponse.status).toBe(200);
    expect(dashboardResponse.status).toBe(200);
    expect(meResponse.status).toBe(200);
    expect(routeMocks.getActivationStatus).toHaveBeenCalledWith(
      { code: "ABCD1234" },
      residentPrincipal,
    );
  });

  it("handles admin and resident food workflows", async () => {
    routeMocks.uploadFoodPhoto.mockResolvedValue({ photo: { id: "photo-1" } });
    routeMocks.resolveAdminHostelId.mockReturnValue("64f0f0f0f0f0f0f0f0f0f0f1");
    routeMocks.getFoodRoutine.mockResolvedValue({ meals: [] });
    routeMocks.saveFoodRoutine.mockResolvedValue({ routine: { meals: [] } });
    routeMocks.listFoodForResident.mockResolvedValue({ photos: [], routine: null });
    routeMocks.submitFoodFeedback.mockResolvedValue({ feedback: { id: "feedback-1" } });

    const routineResponse = await adminFoodRoutineRoute.GET(
      request("/api/v1/hostel-admin/food/routine"),
    );
    const saveRoutineResponse = await adminFoodRoutineRoute.PUT(
      request("/api/v1/hostel-admin/food/routine", {
        body: {
          meals: [
            {
              dayOfWeek: "TUESDAY",
              items: ["Dal", "Rice"],
              mealType: "DINNER",
            },
          ],
          timings: { DINNER: "7 PM" },
        },
        method: "PUT",
      }),
    );
    const adminPhotoResponse = await adminFoodPhotosRoute.POST(
      request("/api/v1/hostel-admin/food/photos", {
        body: { date: "2030-01-01", mealType: "DINNER", photoAssetId: "asset-1" },
        method: "POST",
      }),
    );
    const residentFoodResponse = await residentFoodRoute.GET(
      request("/api/v1/resident/food"),
    );
    const feedbackResponse = await residentFoodFeedbackRoute.POST(
      request("/api/v1/resident/food/feedback", {
        body: {
          date: "2030-01-01",
          isAnonymous: false,
          mealType: "DINNER",
          rating: 4,
        },
        method: "POST",
      }),
    );
    const residentPhotoResponse = await residentFoodPhotosRoute.POST(
      request("/api/v1/resident/food/photos", {
        body: { date: "2030-01-01", mealType: "DINNER", photoAssetId: "asset-2" },
        method: "POST",
      }),
    );

    expect(routineResponse.status).toBe(200);
    expect(saveRoutineResponse.status).toBe(200);
    expect(adminPhotoResponse.status).toBe(201);
    expect(residentFoodResponse.status).toBe(200);
    expect(feedbackResponse.status).toBe(201);
    expect(residentPhotoResponse.status).toBe(201);
  });

  it("handles admin and resident notice workflows", async () => {
    routeMocks.createNotice.mockResolvedValue({ notice: { id: "notice-1" } });
    routeMocks.listNotices.mockResolvedValue({ notices: [] });
    routeMocks.updateNotice.mockResolvedValue({ notice: { id: "notice-1" } });
    routeMocks.listNoticesForResident.mockResolvedValue({ notices: [] });
    routeMocks.markNoticeAsRead.mockResolvedValue({ notice: { isRead: true } });

    const createResponse = await adminNoticesRoute.POST(
      request("/api/v1/hostel-admin/notices", {
        body: { content: "Dining hall closes early.", isUrgent: true, title: "Dinner" },
        method: "POST",
      }),
    );
    const listResponse = await adminNoticesRoute.GET(
      request("/api/v1/hostel-admin/notices?category=GENERAL"),
    );
    const updateResponse = await adminNoticeDetailRoute.PATCH(
      request("/api/v1/hostel-admin/notices/64f0f0f0f0f0f0f0f0f0f0f9", {
        body: { title: "Dinner update" },
        method: "PATCH",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f9" }),
    );
    const residentListResponse = await residentNoticesRoute.GET(
      request("/api/v1/resident/notices"),
    );
    const readResponse = await residentNoticeReadRoute.PATCH(
      request("/api/v1/resident/notices/64f0f0f0f0f0f0f0f0f0f0f9/read", {
        body: {},
        method: "PATCH",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f9" }),
    );

    expect(createResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(residentListResponse.status).toBe(200);
    expect(readResponse.status).toBe(200);
  });

});
