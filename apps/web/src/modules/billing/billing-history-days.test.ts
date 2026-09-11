import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/billing/billing-gateway", () => ({
  documentDownloadUrl: vi.fn(),
  fetchInvoiceDetail: vi.fn(),
  softmatoDocsUrl: vi.fn(),
}));

import {
  daysLeftThrough,
  daysSpanned,
  daysUntil,
} from "@/modules/billing/billing-history.service";

/**
 * The counts plan billing prints, pinned to the hostel that found them wrong:
 * filed at 11:15 am on Bhadra 26, 2083, monthly, with the three-day trial. The
 * screen showed an empty bar reading "15 days left to pay" against Aswin 10.
 */
describe("the day counts on plan billing", () => {
  const filed = new Date("2026-09-11T05:30:31Z");
  const throughAswin25 = new Date("2026-10-11T18:14:59.999Z");
  const dueBhadra29 = new Date("2026-09-14T18:14:59.999Z");

  it("opens a plan full: 31 of 31 days on the day it is filed", () => {
    expect(daysLeftThrough(throughAswin25, filed)).toBe(31);
    expect(daysSpanned(filed, throughAswin25)).toBe(31);
  });

  it("reads 1 on the plan's last day and 0 from the next midnight", () => {
    expect(daysLeftThrough(throughAswin25, new Date("2026-10-11T17:00:00Z"))).toBe(1);
    expect(daysLeftThrough(throughAswin25, new Date("2026-10-11T18:15:00Z"))).toBe(0);
  });

  it("counts a Bhadra 29 due as 3 days out all through Bhadra 26", () => {
    expect(daysUntil(dueBhadra29, new Date("2026-09-10T18:15:00Z"))).toBe(3);
    expect(daysUntil(dueBhadra29, filed)).toBe(3);
    expect(daysUntil(dueBhadra29, new Date("2026-09-11T18:14:00Z"))).toBe(3);
    // Midnight in Kathmandu, and not before.
    expect(daysUntil(dueBhadra29, new Date("2026-09-11T18:15:00Z"))).toBe(2);
    // The day itself — "last day to pay".
    expect(daysUntil(dueBhadra29, new Date("2026-09-14T12:00:00Z"))).toBe(0);
  });
});
