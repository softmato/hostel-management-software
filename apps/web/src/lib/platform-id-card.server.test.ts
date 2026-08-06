import { describe, expect, it } from "vitest";

import type { IdCardData, PlatformIdCardType } from "@/lib/platform-id-card";
import { renderIdCardPng } from "@/lib/platform-id-card.server";

/**
 * The emailed card is drawn by the same code as the on-screen one, through a
 * Node canvas rather than the browser's. That substitution is the whole risk
 * here — if the native context ever stops accepting what the shared renderer
 * asks of it, approval emails silently lose their attachment. These tests are
 * the tripwire for that.
 */

const BASE: IdCardData = {
  bloodGroup: "O+",
  brandName: "Hostel Days",
  dateOfBirth: "12 Mar 2001",
  email: "resident@example.com",
  fullName: "Asha Bahadur Gurung",
  issuedOn: "01 Aug 2026",
  phone: "+977-9800000000",
  residentId: "HH-4K7M-9XQ2",
  role: "Resident",
  siteLabel: "hosteldays.com.np",
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderIdCardPng", () => {
  const types: PlatformIdCardType[] = [
    "RESIDENT",
    "HOSTEL_OWNER",
    "SERVICE_PROVIDER",
  ];

  it.each(types)("renders both faces of the %s card as PNG", async (cardType) => {
    for (const face of ["front", "back"] as const) {
      const png = await renderIdCardPng({ ...BASE, cardType }, face);

      expect(png).not.toBeNull();
      expect(png!.subarray(0, 4)).toEqual(PNG_MAGIC);
      // A blank canvas still encodes; a card that actually drew is far larger.
      expect(png!.byteLength).toBeGreaterThan(5_000);
    }
  });

  it("degrades to a card rather than failing when the photo bytes are junk", async () => {
    const png = await renderIdCardPng(BASE, "front", {
      photo: Buffer.from("not an image"),
      qr: Buffer.from("not an image either"),
    });

    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4)).toEqual(PNG_MAGIC);
  });
});
