import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  addHostelAdminInquiryNote: vi.fn(),
  addHostelAdminProfilePhoto: vi.fn(),
  approvePlatformHostel: vi.fn(),
  createPlatformHostelApplication: vi.fn(),
  createPublicHostelInquiry: vi.fn(),
  deleteHostelAdminProfilePhoto: vi.fn(),
  getHostelAdminProfile: vi.fn(),
  getPlatformHostel: vi.fn(),
  getPublicHostelBySlug: vi.fn(),
  listHostelAdminInquiries: vi.fn(),
  listPlatformHostels: vi.fn(),
  listPublicHostels: vi.fn(),
  loadApiPrincipal: vi.fn(),
  publishPlatformHostel: vi.fn(),
  shouldPromptAfterInquiry: vi.fn(),
  rejectPlatformHostel: vi.fn(),
  requireHostelCapability: vi.fn(),
  requireHostelStaffPrincipal: vi.fn(),
  requirePlatformPrincipal: vi.fn(),
  updateHostelAdminInquiryStatus: vi.fn(),
  updateHostelAdminProfile: vi.fn(),
  unpublishPlatformHostel: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  loadApiPrincipal: routeMocks.loadApiPrincipal,
  requireHostelCapability: routeMocks.requireHostelCapability,
  requireHostelStaffPrincipal: routeMocks.requireHostelStaffPrincipal,
  requirePlatformPrincipal: routeMocks.requirePlatformPrincipal,
}));

vi.mock("@/modules/users/resident-identity.service", () => ({
  shouldPromptAfterInquiry: routeMocks.shouldPromptAfterInquiry,
}));

vi.mock("@/modules/hostels/hostel.service", () => ({
  addHostelAdminInquiryNote: routeMocks.addHostelAdminInquiryNote,
  addHostelAdminProfilePhoto: routeMocks.addHostelAdminProfilePhoto,
  approvePlatformHostel: routeMocks.approvePlatformHostel,
  createPlatformHostelApplication: routeMocks.createPlatformHostelApplication,
  createPublicHostelInquiry: routeMocks.createPublicHostelInquiry,
  deleteHostelAdminProfilePhoto: routeMocks.deleteHostelAdminProfilePhoto,
  getHostelAdminProfile: routeMocks.getHostelAdminProfile,
  getPlatformHostel: routeMocks.getPlatformHostel,
  getPublicHostelBySlug: routeMocks.getPublicHostelBySlug,
  listHostelAdminInquiries: routeMocks.listHostelAdminInquiries,
  listPlatformHostels: routeMocks.listPlatformHostels,
  listPublicHostels: routeMocks.listPublicHostels,
  publishPlatformHostel: routeMocks.publishPlatformHostel,
  rejectPlatformHostel: routeMocks.rejectPlatformHostel,
  updateHostelAdminInquiryStatus: routeMocks.updateHostelAdminInquiryStatus,
  updateHostelAdminProfile: routeMocks.updateHostelAdminProfile,
  unpublishPlatformHostel: routeMocks.unpublishPlatformHostel,
}));

vi.mock("@/modules/hostels/hostel-inquiry.service", () => ({
  addHostelAdminInquiryNote: routeMocks.addHostelAdminInquiryNote,
  listHostelAdminInquiries: routeMocks.listHostelAdminInquiries,
  updateHostelAdminInquiryStatus: routeMocks.updateHostelAdminInquiryStatus,
}));

vi.mock("@/modules/hostels/hostel-profile.service", () => ({
  addHostelAdminProfilePhoto: routeMocks.addHostelAdminProfilePhoto,
  deleteHostelAdminProfilePhoto: routeMocks.deleteHostelAdminProfilePhoto,
  getHostelAdminProfile: routeMocks.getHostelAdminProfile,
  updateHostelAdminProfile: routeMocks.updateHostelAdminProfile,
}));

import * as adminInquiryNotesRoute from "@/app/api/v1/hostel-admin/inquiries/[id]/notes/route";
import * as adminInquiryStatusRoute from "@/app/api/v1/hostel-admin/inquiries/[id]/status/route";
import * as adminInquiriesRoute from "@/app/api/v1/hostel-admin/inquiries/route";
import * as adminPhotosDetailRoute from "@/app/api/v1/hostel-admin/profile/photos/[photoId]/route";
import * as adminPhotosRoute from "@/app/api/v1/hostel-admin/profile/photos/route";
import * as adminProfileRoute from "@/app/api/v1/hostel-admin/profile/route";
import * as platformApproveRoute from "@/app/api/v1/platform/hostels/[id]/approve/route";
import * as platformPublishRoute from "@/app/api/v1/platform/hostels/[id]/publish/route";
import * as platformRejectRoute from "@/app/api/v1/platform/hostels/[id]/reject/route";
import * as platformDetailRoute from "@/app/api/v1/platform/hostels/[id]/route";
import * as platformUnpublishRoute from "@/app/api/v1/platform/hostels/[id]/unpublish/route";
import * as platformHostelsRoute from "@/app/api/v1/platform/hostels/route";
import * as publicInquiryRoute from "@/app/api/v1/public/hostels/[slug]/inquiries/route";
import * as publicDetailRoute from "@/app/api/v1/public/hostels/[slug]/route";
import * as publicHostelsRoute from "@/app/api/v1/public/hostels/route";

const principal = {
  hostelIds: [],
  role: "SUPERADMIN",
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0f1",
};

const staffPrincipal = {
  hostelIds: ["64f0f0f0f0f0f0f0f0f0f0f4"],
  role: "HOSTEL_ADMIN",
  sessionId: "session-2",
  userId: "64f0f0f0f0f0f0f0f0f0f0f5",
};

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function getRequest(path: string) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    method: "GET",
  });
}

function patchRequest(path: string, body?: unknown) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    method: "PATCH",
  });
}

function deleteRequest(path: string) {
  return new NextRequest(`https://hostelhub.local${path}`, {
    method: "DELETE",
  });
}

function routeContext<T extends Record<string, string>>(params: T) {
  return {
    params: Promise.resolve(params),
  };
}

describe("platform hostel routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireHostelStaffPrincipal.mockResolvedValue(staffPrincipal);
    routeMocks.requireHostelCapability.mockResolvedValue(staffPrincipal);
    routeMocks.requirePlatformPrincipal.mockResolvedValue(principal);
  });

  it("creates platform hostel applications through the route handler", async () => {
    routeMocks.createPlatformHostelApplication.mockResolvedValue({
      application: { id: "application-1", status: "PENDING" },
      hostel: { id: "hostel-1", name: "Sunrise Hostel", status: "PENDING_APPROVAL" },
    });

    const response = await platformHostelsRoute.POST(
      jsonRequest("/api/v1/platform/hostels", {
        location: {
          area: "Baneshwor",
        },
        name: "Sunrise Hostel",
        ownerId: "64f0f0f0f0f0f0f0f0f0f0f2",
        pricing: {
          monthlyRentMin: 9000,
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      data: {
        hostel: {
          status: "PENDING_APPROVAL",
        },
      },
      success: true,
    });
    expect(routeMocks.createPlatformHostelApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        facilities: [],
        hostelType: "CO_LIVING",
        location: expect.objectContaining({
          area: "Baneshwor",
          city: "Kathmandu",
        }),
        ownerId: "64f0f0f0f0f0f0f0f0f0f0f2",
      }),
      principal,
    );
  });

  it("rejects invalid platform hostel create payloads before calling the service", async () => {
    const response = await platformHostelsRoute.POST(
      jsonRequest("/api/v1/platform/hostels", {
        location: {
          area: "A",
        },
        name: "",
        ownerId: "not-an-object-id",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      errorCode: "VALIDATION_ERROR",
      success: false,
    });
    expect(routeMocks.createPlatformHostelApplication).not.toHaveBeenCalled();
  });

  it("loads platform hostel lists and parses status query filters", async () => {
    routeMocks.listPlatformHostels.mockResolvedValue({
      hostels: [{ id: "hostel-1", status: "PENDING_APPROVAL" }],
    });

    const response = await platformHostelsRoute.GET(
      getRequest("/api/v1/platform/hostels?status=PENDING_APPROVAL"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostels).toHaveLength(1);
    expect(routeMocks.listPlatformHostels).toHaveBeenCalledWith({
      status: "PENDING_APPROVAL",
    });
  });

  it("loads platform hostel detail by id", async () => {
    routeMocks.getPlatformHostel.mockResolvedValue({
      application: { id: "application-1", status: "PENDING" },
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", name: "Sunrise Hostel" },
    });

    const response = await platformDetailRoute.GET(
      getRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3"),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.id).toBe("64f0f0f0f0f0f0f0f0f0f0f3");
    expect(routeMocks.getPlatformHostel).toHaveBeenCalledWith("64f0f0f0f0f0f0f0f0f0f0f3");
  });

  it("approves platform hostels with the authenticated principal", async () => {
    routeMocks.approvePlatformHostel.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", status: "APPROVED" },
    });

    const response = await platformApproveRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/approve"),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.status).toBe("APPROVED");
    expect(routeMocks.approvePlatformHostel).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f3",
      principal,
    );
  });

  it("rejects platform hostels with a review reason", async () => {
    routeMocks.rejectPlatformHostel.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", status: "REJECTED" },
    });

    const response = await platformRejectRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/reject", {
        reason: "Ownership document is unreadable.",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.status).toBe("REJECTED");
    expect(routeMocks.rejectPlatformHostel).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f3",
      { reason: "Ownership document is unreadable." },
      principal,
    );
  });

  it("publishes platform hostels with the authenticated principal", async () => {
    routeMocks.publishPlatformHostel.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", status: "PUBLISHED" },
      notification: { sent: true, to: "owner@example.com" },
    });

    const response = await platformPublishRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/publish"),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.status).toBe("PUBLISHED");
    expect(routeMocks.publishPlatformHostel).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f3",
      principal,
    );
  });

  it("unpublishes platform hostels with the reason and authenticated principal", async () => {
    routeMocks.unpublishPlatformHostel.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", status: "APPROVED" },
      notification: { sent: true, to: "owner@example.com" },
    });

    const response = await platformUnpublishRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/unpublish", {
        reason: "Listing photos no longer match the property.",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.status).toBe("APPROVED");
    expect(routeMocks.unpublishPlatformHostel).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f3",
      { reason: "Listing photos no longer match the property." },
      principal,
    );
  });

  it("rejects an unpublish request that omits the owner-facing reason", async () => {
    const response = await platformUnpublishRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/unpublish", {}),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );

    expect(response.status).toBe(422);
    expect(routeMocks.unpublishPlatformHostel).not.toHaveBeenCalled();
  });

  it("warns the reviewer when the owner could not be emailed", async () => {
    routeMocks.unpublishPlatformHostel.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f3", status: "APPROVED" },
      notification: { reason: "send_failed", sent: false, to: "owner@example.com" },
    });

    const response = await platformUnpublishRoute.PATCH(
      patchRequest("/api/v1/platform/hostels/64f0f0f0f0f0f0f0f0f0f0f3/unpublish", {
        reason: "Duplicate listing.",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toContain("could not be emailed");
  });

  it("loads public hostel listings with search and filters", async () => {
    routeMocks.listPublicHostels.mockResolvedValue({
      hostels: [{ id: "hostel-1", name: "Sunrise Hostel", slug: "sunrise-hostel" }],
    });

    const response = await publicHostelsRoute.GET(
      getRequest(
        "/api/v1/public/hostels?q=sunrise&area=Baneshwor&type=GIRLS&minPrice=8000&maxPrice=15000&facility=wifi&food=veg&roomType=single",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostels).toHaveLength(1);
    expect(routeMocks.listPublicHostels).toHaveBeenCalledWith({
      area: "Baneshwor",
      facility: "wifi",
      food: "veg",
      maxPrice: 15000,
      minPrice: 8000,
      q: "sunrise",
      roomType: "single",
      type: "GIRLS",
    });
  });

  it("loads public hostel detail by slug", async () => {
    routeMocks.getPublicHostelBySlug.mockResolvedValue({
      hostel: { id: "hostel-1", name: "Sunrise Hostel", slug: "sunrise-hostel" },
    });

    const response = await publicDetailRoute.GET(
      getRequest("/api/v1/public/hostels/sunrise-hostel"),
      routeContext({ slug: "sunrise-hostel" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.hostel.slug).toBe("sunrise-hostel");
    expect(routeMocks.getPublicHostelBySlug).toHaveBeenCalledWith("sunrise-hostel");
  });

  it("submits public inquiries against a hostel id", async () => {
    routeMocks.createPublicHostelInquiry.mockResolvedValue({
      inquiry: { id: "inquiry-1", status: "NEW" },
    });
    routeMocks.loadApiPrincipal.mockResolvedValue(null);
    routeMocks.shouldPromptAfterInquiry.mockResolvedValue(true);

    const response = await publicInquiryRoute.POST(
      jsonRequest("/api/v1/public/hostels/64f0f0f0f0f0f0f0f0f0f0f3/inquiries", {
        message: "Can I visit tomorrow?",
        name: "Asha Rai",
        phone: "9800000000",
      }),
      routeContext({ slug: "64f0f0f0f0f0f0f0f0f0f0f3" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.inquiry.status).toBe("NEW");
    // Signals the client to offer the fill-once resident profile.
    expect(payload.data.shouldCollectProfile).toBe(true);
    expect(routeMocks.createPublicHostelInquiry).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f3",
      expect.objectContaining({
        name: "Asha Rai",
        phone: "9800000000",
      }),
    );
  });

  it("loads hostel-admin inquiries with tenant query filters", async () => {
    routeMocks.listHostelAdminInquiries.mockResolvedValue({
      inquiries: [{ id: "inquiry-1", status: "NEW" }],
    });

    const response = await adminInquiriesRoute.GET(
      getRequest(
        "/api/v1/hostel-admin/inquiries?status=NEW&hostelId=64f0f0f0f0f0f0f0f0f0f0f4",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.inquiries).toHaveLength(1);
    expect(routeMocks.listHostelAdminInquiries).toHaveBeenCalledWith(
      {
        hostelId: "64f0f0f0f0f0f0f0f0f0f0f4",
        status: "NEW",
      },
      staffPrincipal,
    );
  });

  it("updates hostel-admin inquiry status", async () => {
    routeMocks.updateHostelAdminInquiryStatus.mockResolvedValue({
      inquiry: { id: "64f0f0f0f0f0f0f0f0f0f0f6", status: "CONTACTED" },
    });

    const response = await adminInquiryStatusRoute.PATCH(
      patchRequest("/api/v1/hostel-admin/inquiries/64f0f0f0f0f0f0f0f0f0f0f6/status", {
        status: "CONTACTED",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f6" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.inquiry.status).toBe("CONTACTED");
    expect(routeMocks.updateHostelAdminInquiryStatus).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f6",
      { status: "CONTACTED" },
      staffPrincipal,
    );
  });

  it("adds hostel-admin inquiry follow-up notes", async () => {
    routeMocks.addHostelAdminInquiryNote.mockResolvedValue({
      note: { id: "note-1", note: "Called guardian." },
    });

    const response = await adminInquiryNotesRoute.POST(
      jsonRequest("/api/v1/hostel-admin/inquiries/64f0f0f0f0f0f0f0f0f0f0f6/notes", {
        note: "Called guardian.",
      }),
      routeContext({ id: "64f0f0f0f0f0f0f0f0f0f0f6" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.note.note).toBe("Called guardian.");
    expect(routeMocks.addHostelAdminInquiryNote).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f6",
      { note: "Called guardian." },
      staffPrincipal,
    );
  });

  it("loads and updates the hostel-admin profile", async () => {
    routeMocks.getHostelAdminProfile.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f4", name: "Sunrise Hostel" },
    });
    routeMocks.updateHostelAdminProfile.mockResolvedValue({
      hostel: { id: "64f0f0f0f0f0f0f0f0f0f0f4", name: "Sunrise Girls Hostel" },
    });

    const getResponse = await adminProfileRoute.GET(
      getRequest("/api/v1/hostel-admin/profile"),
    );
    const patchResponse = await adminProfileRoute.PATCH(
      patchRequest("/api/v1/hostel-admin/profile", {
        facilities: ["wifi", "laundry"],
        name: "Sunrise Girls Hostel",
      }),
    );
    const patchPayload = await patchResponse.json();

    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
    expect(patchPayload.data.hostel.name).toBe("Sunrise Girls Hostel");
    expect(routeMocks.updateHostelAdminProfile).toHaveBeenCalledWith(
      {
        facilities: ["wifi", "laundry"],
        name: "Sunrise Girls Hostel",
      },
      staffPrincipal,
    );
  });

  it("adds and deletes hostel profile photos", async () => {
    routeMocks.addHostelAdminProfilePhoto.mockResolvedValue({
      hostel: { id: "hostel-1" },
    });
    routeMocks.deleteHostelAdminProfilePhoto.mockResolvedValue({
      hostel: { id: "hostel-1" },
    });

    const addResponse = await adminPhotosRoute.POST(
      jsonRequest("/api/v1/hostel-admin/profile/photos", {
        alt: "Front gate",
        url: "https://assets.example.com/front.jpg",
      }),
    );
    const deleteResponse = await adminPhotosDetailRoute.DELETE(
      deleteRequest("/api/v1/hostel-admin/profile/photos/64f0f0f0f0f0f0f0f0f0f0f7"),
      routeContext({ photoId: "64f0f0f0f0f0f0f0f0f0f0f7" }),
    );

    expect(addResponse.status).toBe(201);
    expect(deleteResponse.status).toBe(200);
    expect(routeMocks.addHostelAdminProfilePhoto).toHaveBeenCalledWith(
      {
        alt: "Front gate",
        kind: "INTERIOR",
        url: "https://assets.example.com/front.jpg",
      },
      staffPrincipal,
    );
    expect(routeMocks.deleteHostelAdminProfilePhoto).toHaveBeenCalledWith(
      "64f0f0f0f0f0f0f0f0f0f0f7",
      {},
      staffPrincipal,
    );
  });



});
