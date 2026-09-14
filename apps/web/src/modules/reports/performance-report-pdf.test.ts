import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  changeLabel,
  renderPerformanceReportPdf,
  rupees,
} from "@/modules/reports/performance-report-pdf";
import type { PerformanceReport } from "@/modules/reports/performance-report.service";

/**
 * The performance PDF's failure modes: a hostel name the standard fonts cannot
 * encode, a brand-new hostel with nothing in any section, and the promise that
 * it is two pages whatever the payload holds.
 */

function report(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  const trend = ["2082-12", "2083-01", "2083-02", "2083-03", "2083-04", "2083-05"].map(
    (month, index) => ({
      billed: 300_000 + index * 10_000,
      collected: 250_000 + index * 12_000,
      collectionRate: 85,
      month,
    }),
  );

  return {
    beds: { occupancyRate: 90, occupied: 38, total: 42, vacant: 4 },
    finance: {
      billed: 350_000,
      collected: 310_000,
      collectionRate: 88.6,
      methods: [
        { count: 12, method: "ESEWA" },
        { count: 8, method: "CASH" },
      ],
      outstanding: 40_000,
      outstandingAllTime: 65_000,
      pendingProofs: 3,
      previous: { billed: 340_000, collected: 298_000, collectionRate: 87.6 },
      trend,
    },
    generatedAt: "2026-09-14T09:30:00.000Z",
    hostelName: "Green View Hostel",
    listing: {
      appearances: { change: 20, current: 1_200, previous: 1_000 },
      inquiries: { change: null, current: 6, previous: 0 },
      inquiriesConverted: 2,
      rating: { average: 4.3, newThisMonth: 2, total: 18 },
      views: { change: -10, current: 270, previous: 300 },
      visitors: { change: 5, current: 210, previous: 200 },
    },
    operations: {
      complaints: { open: 2, pastSla: 1, raised: 5, resolved: 4 },
      repairs: { completed: 3, open: 1, raised: 4 },
    },
    period: {
      end: "2026-09-14T09:30:00.000Z",
      isCurrent: true,
      month: "2083-05",
      months: ["2083-05", "2083-04"],
      previousMonth: "2083-04",
      start: "2026-08-17T18:15:00.000Z",
    },
    residents: {
      movedIn: 4,
      movedOut: 1,
      now: { active: 38, pending: 3, suspended: 1, total: 42 },
      tonight: { inside: 30, night: "2026-09-13", notAnswered: 4, outside: 8 },
    },
    ...overrides,
  };
}

describe("renderPerformanceReportPdf", () => {
  it("renders two pages", async () => {
    const pdf = await renderPerformanceReportPdf(report());

    expect(Buffer.from(pdf).toString("latin1").startsWith("%PDF-")).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it("does not throw on a hostel name outside WinAnsi", async () => {
    await expect(
      renderPerformanceReportPdf(report({ hostelName: "शान्ति भवन — Hostel" })),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("renders a hostel with nothing in any section", async () => {
    const empty = report();
    const pdf = await renderPerformanceReportPdf({
      ...empty,
      beds: { occupancyRate: null, occupied: 0, total: 0, vacant: 0 },
      finance: {
        ...empty.finance,
        billed: 0,
        collected: 0,
        collectionRate: null,
        methods: [],
        outstanding: 0,
        outstandingAllTime: 0,
        pendingProofs: 0,
        previous: { billed: 0, collected: 0, collectionRate: null },
        trend: empty.finance.trend.map((point) => ({
          ...point,
          billed: 0,
          collected: 0,
          collectionRate: null,
        })),
      },
      hostelName: "",
      residents: {
        movedIn: 0,
        movedOut: 0,
        now: { active: 0, pending: 0, suspended: 0, total: 0 },
        tonight: { inside: 0, night: "2026-09-13", notAnswered: 0, outside: 0 },
      },
    });

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });
});

describe("report figures", () => {
  it("groups rupees the South Asian way", () => {
    expect(rupees(1_250_000)).toBe("Rs 12,50,000");
  });

  it("names a change without dividing by nothing", () => {
    expect(changeLabel(120, 100)).toBe("+20%");
    expect(changeLabel(90, 100)).toBe("-10%");
    expect(changeLabel(5, 0)).toBe("New");
    expect(changeLabel(0, 0)).toBe("-");
    expect(changeLabel(100, 100)).toBe("No change");
  });
});
