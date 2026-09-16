/**
 * Where a booking notification opens — docs/BOOKINGS.md item 11.
 *
 * The quiet failure: every booking bell carries a website `actionUrl`, which
 * both routing tables prefer, so an app push would open `/bookings/<id>` — not
 * an app route — and land on the notification list.
 */
import { describe, expect, it } from "vitest";

import { Role } from "@/lib/roles";
import { topicsForCategory } from "@/lib/realtime/channels";
import { deepLinkForNotification } from "@/modules/notifications/push-routing";
import { webLinkForNotification } from "@/modules/notifications/web-routing";

const bookingId = "64f0f0f0f0f0f0f0f0f0f0a1";

describe("booking notification links", () => {
  it("opens the app's own booking screens, not the website's paths", () => {
    expect(
      deepLinkForNotification({
        actionUrl: `/bookings/${bookingId}`,
        category: "BOOKING",
        data: { audience: "GUEST", bookingId },
      }),
    ).toBe(`/booking/${bookingId}`);
    expect(
      deepLinkForNotification({
        actionUrl: "/hostel-admin/bookings",
        category: "BOOKING",
        data: { audience: "HOSTEL", bookingId },
      }),
    ).toBe("/manage/bookings");
    expect(
      deepLinkForNotification({
        actionUrl: "/platform/bookings?tab=refunds",
        category: "BOOKING",
        data: { audience: "PLATFORM", bookingId },
      }),
    ).toBe("/notifications");
  });

  it("keeps the website's own link, and falls back per portal", () => {
    expect(
      webLinkForNotification({ actionUrl: `/bookings/${bookingId}`, category: "BOOKING", role: Role.PUBLIC }),
    ).toBe(`/bookings/${bookingId}`);
    expect(webLinkForNotification({ category: "BOOKING", role: Role.WARDEN })).toBe("/hostel-admin/bookings");
    expect(webLinkForNotification({ category: "BOOKING", role: Role.SUPERADMIN })).toBe("/platform/bookings");
  });

  it("refreshes the booking panels", () => {
    expect(topicsForCategory("BOOKING")).toEqual(["bookings"]);
  });
});
