import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/og/route";
import { ogImagePath } from "@/lib/seo";

beforeEach(() => {
  vi.stubEnv("JWT_ACCESS_SECRET", "s".repeat(40));
  vi.stubEnv("APP_URL", "https://hostelpalika.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function render(path: string) {
  const response = await GET(new NextRequest(new URL(path, "https://hostelpalika.com")));
  const bytes = new Uint8Array(await response.arrayBuffer());

  return { bytes, type: response.headers.get("content-type") };
}

describe("/og social card", () => {
  it("draws a signed title as a 1200×630 PNG", async () => {
    const { bytes, type } = await render(
      ogImagePath("Hostel Management System & Software in Nepal", "For hostel owners"),
    );

    expect(type).toBe("image/png");
    // PNG signature, then the IHDR width and height.
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  }, 30_000);

  it("still answers with the brand card when the text was tampered with", async () => {
    const url = new URL(ogImagePath("Plans & Pricing"), "https://hostelpalika.com");
    url.searchParams.set("t", "Something nobody wrote");

    const { bytes, type } = await render(`${url.pathname}${url.search}`);

    expect(type).toBe("image/png");
    expect(bytes.length).toBeGreaterThan(1000);
  }, 30_000);
});
