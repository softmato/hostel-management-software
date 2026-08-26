import { describe, expect, it } from "vitest";

import type { AdminHostel, AdminPeriodRow } from "@/lib/admin-api";
import {
  collectionRate,
  earningsSummary,
  earningsTrend,
  heroAmountSize,
  heroPhotoUrl,
  hostelAreaLabel,
  listingState,
  monthOverMonth,
  monthShortLabel,
  nightChips,
  occupancyLine,
  trendAxis,
  trendPoints,
  trendSegments,
  trendTickLabel,
} from "@/lib/admin-home";

function period(
  month: string,
  collected: number,
  due = collected,
): AdminPeriodRow {
  return { collected, due, needsAttention: 0, paid: 0, period: month, total: 0 };
}

function hostel(overrides: Partial<AdminHostel> = {}): AdminHostel {
  return {
    capacitySummary: {},
    contact: {},
    hostelType: "CO_LIVING",
    id: "hostel-1",
    location: {},
    name: "Shanti Bhawan",
    photos: [],
    slug: "shanti-bhawan",
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
    ...overrides,
  };
}

describe("monthShortLabel", () => {
  it("names the month", () => {
    expect(monthShortLabel("2026-08")).toBe("Aug");
    expect(monthShortLabel("2026-01")).toBe("Jan");
    expect(monthShortLabel("2026-12")).toBe("Dec");
  });

  it("hands back anything it cannot parse rather than rendering undefined", () => {
    expect(monthShortLabel("2026-13")).toBe("2026-13");
    expect(monthShortLabel("August")).toBe("August");
    expect(monthShortLabel("")).toBe("");
  });
});

describe("collectionRate", () => {
  it("is the share of the billed total that came in", () => {
    expect(collectionRate(7500, 10000)).toBe(75);
  });

  it("is null when nothing was billed, not zero", () => {
    // A hostel that has not run its billing has not collected 0% — the
    // question does not apply, and a red empty meter would say it does.
    expect(collectionRate(0, 0)).toBeNull();
  });

  it("caps at 100 on an overpayment", () => {
    // Two months settled in one transfer. A meter past its own track reads as
    // a rendering bug rather than as good news.
    expect(collectionRate(12000, 10000)).toBe(100);
  });
});

describe("earningsTrend", () => {
  const months = [
    period("2026-08", 40000),
    period("2026-07", 80000),
    period("2026-06", 20000),
    period("2026-05", 60000),
    period("2026-04", 10000),
    period("2026-03", 30000),
    period("2026-02", 90000),
  ];

  it("reverses the server's newest-first order so time runs left to right", () => {
    expect(earningsTrend(months, 3).map((bar) => bar.period)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("sizes each bar against the tallest in the window, not against all time", () => {
    // February is the biggest month overall and is outside this window, so
    // July — the window's own peak — is the full-height bar.
    const bars = earningsTrend(months, 3);

    expect(bars.map((bar) => bar.fill)).toEqual([0.25, 1, 0.5]);
  });

  it("marks the newest month so the chart can pick out now", () => {
    const bars = earningsTrend(months, 3);

    expect(bars.filter((bar) => bar.latest).map((bar) => bar.period)).toEqual([
      "2026-08",
    ]);
  });

  it("gives every bar zero rather than NaN when nothing was collected", () => {
    const bars = earningsTrend([period("2026-08", 0), period("2026-07", 0)]);

    expect(bars.map((bar) => bar.fill)).toEqual([0, 0]);
  });

  it("copes with fewer months than the window asks for", () => {
    expect(earningsTrend([period("2026-08", 5000)], 6)).toHaveLength(1);
  });
});

describe("trendAxis", () => {
  const window = (...collected: number[]) =>
    earningsTrend(
      collected.map((amount, index) => period(`2026-0${index + 1}`, amount)),
      collected.length,
    );

  it("rounds the ceiling up to a round step above the peak", () => {
    // 74,300 / 4 slices = 18,575 a slice, which rounds up to 20,000.
    expect(trendAxis(window(74300, 10000)).ceiling).toBe(80000);
  });

  it("labels the ticks top-first, so gridlines draw in order", () => {
    expect(trendAxis(window(74300, 10000)).ticks).toEqual([
      80000, 60000, 40000, 20000, 0,
    ]);
  });

  it("keeps the peak strictly inside the plot", () => {
    for (const peak of [1, 999, 45000, 123456, 4_000_000]) {
      expect(trendAxis(window(peak)).ceiling).toBeGreaterThanOrEqual(peak);
    }
  });

  it("gives a window that collected nothing a flat zero axis, not NaN", () => {
    expect(trendAxis(window(0, 0))).toEqual({
      ceiling: 0,
      ticks: [0, 0, 0, 0, 0],
    });
  });
});

describe("trendPoints", () => {
  const bars = earningsTrend(
    [
      period("2026-04", 100),
      period("2026-03", 50),
      period("2026-02", 0),
      period("2026-01", 100),
    ],
    4,
  );

  it("spaces the months at the centres of equal columns", () => {
    // Four months across 400 points: half a column in, then one column apart.
    expect(trendPoints(bars, 100, 400, 100).map((point) => point.x)).toEqual([
      50, 150, 250, 350,
    ]);
  });

  it("measures height downwards, so the biggest month has the smallest y", () => {
    // Jan and Apr are the peak, Feb is zero, Mar is half.
    expect(trendPoints(bars, 100, 400, 100).map((point) => point.y)).toEqual([
      0, 100, 50, 0,
    ]);
  });

  it("puts every month on the baseline when nothing was collected", () => {
    const flat = earningsTrend([period("2026-02", 0), period("2026-01", 0)], 2);

    expect(trendPoints(flat, 0, 400, 100).map((point) => point.y)).toEqual([
      100, 100,
    ]);
  });
});

describe("trendSegments", () => {
  it("joins the points, one segment per gap", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 60, y: 40 },
    ];

    expect(trendSegments(points, 2).map((segment) => segment.width)).toEqual([
      50, 30,
    ]);
  });

  it("places each segment by its centre, which is what a rotate turns about", () => {
    // A 3-4-5 triangle: the segment is 50 long, its midpoint is (15, 20), so
    // its box starts 25 left of that and half its thickness above it.
    const [segment] = trendSegments(
      [
        { x: 0, y: 0 },
        { x: 30, y: 40 },
      ],
      2,
    );

    expect(segment.left).toBe(-10);
    expect(segment.top).toBe(19);
  });

  it("angles a rising month upwards and a falling one down", () => {
    const [up, down] = trendSegments(
      [
        { x: 0, y: 20 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      2,
    );

    // y grows downwards, so a month that collected more is a negative angle.
    expect(up.angle).toBeLessThan(0);
    expect(down.angle).toBeGreaterThan(0);
  });

  it("has nothing to draw for a single month", () => {
    expect(trendSegments([{ x: 5, y: 5 }], 2)).toEqual([]);
  });
});

describe("trendTickLabel", () => {
  it("leaves figures under a thousand alone", () => {
    expect(trendTickLabel(0)).toBe("0");
    expect(trendTickLabel(750)).toBe("750");
  });

  it("shortens thousands and millions", () => {
    expect(trendTickLabel(20000)).toBe("20k");
    expect(trendTickLabel(250000)).toBe("250k");
    expect(trendTickLabel(1_200_000)).toBe("1.2m");
  });

  it("drops a decimal that is zero", () => {
    expect(trendTickLabel(2_000_000)).toBe("2m");
  });
});

describe("monthOverMonth", () => {
  it("compares this month with last and names the month it beat", () => {
    expect(
      monthOverMonth([period("2026-08", 112000), period("2026-07", 100000)]),
    ).toEqual({ direction: "up", label: "Up 12% on Jul", percent: 12 });
  });

  it("says down without a minus sign in the percentage", () => {
    // The direction carries the sign. A "-8%" beside the word "Down" reads as
    // a double negative to somebody scanning.
    expect(
      monthOverMonth([period("2026-08", 92000), period("2026-07", 100000)]),
    ).toEqual({ direction: "down", label: "Down 8% on Jul", percent: 8 });
  });

  it("has a word for no change", () => {
    expect(monthOverMonth([period("2026-08", 100000), period("2026-07", 100000)])).toEqual(
      { direction: "flat", label: "Level with Jul", percent: 0 },
    );
  });

  it("is null when last month collected nothing", () => {
    // Every percentage formula returns infinity here, and "up infinity" is not
    // a thing to put on a dashboard.
    expect(monthOverMonth([period("2026-08", 50000), period("2026-07", 0)])).toBeNull();
  });

  it("is null in a hostel's first month", () => {
    expect(monthOverMonth([period("2026-08", 50000)])).toBeNull();
    expect(monthOverMonth([])).toBeNull();
  });
});

describe("earningsSummary", () => {
  const report = { monthlyDues: 100000, paidAmount: 65000 };

  it("takes the month from the roll-up when both sources answered", () => {
    // Same invoices, different code: the report scopes to the calendar month
    // and the roll-up keys on the invoice's own period. Mixing them is how a
    // screen stops adding up.
    const summary = earningsSummary({
      months: [period("2026-08", 70000, 110000)],
      overall: { collected: 900000, outstanding: 140000 },
      report,
    });

    expect(summary).toEqual({
      lifetime: 900000,
      outstanding: 140000,
      outstandingIsLifetime: true,
      thisMonth: 70000,
      thisMonthBilled: 110000,
    });
  });

  it("degrades to the report when the periods read was refused", () => {
    // A warden without `viewPayments` gets a 403 there and a 200 here. The
    // lifetime figure is genuinely unknown, so it is null rather than zero.
    const summary = earningsSummary({ months: null, overall: null, report });

    expect(summary).toEqual({
      lifetime: null,
      outstanding: 35000,
      outstandingIsLifetime: false,
      thisMonth: 65000,
      thisMonthBilled: 100000,
    });
  });

  it("never reports a negative shortfall on the fallback path", () => {
    const summary = earningsSummary({
      months: null,
      overall: null,
      report: { monthlyDues: 50000, paidAmount: 62000 },
    });

    expect(summary.outstanding).toBe(0);
  });
});

describe("heroAmountSize", () => {
  it("leaves an ordinary hostel's total at full size", () => {
    expect(heroAmountSize("NPR 1,284,000")).toBe(34);
  });

  it("steps down rather than letting a long total ellipse", () => {
    // `NPR 12,84,…` is not a smaller version of the number, it is a different
    // number — the one truncation a total must never take.
    expect(heroAmountSize("NPR 128,400,000")).toBe(29);
    expect(heroAmountSize("NPR 1,284,000,000")).toBe(29);
    expect(heroAmountSize("NPR 12,840,000,000")).toBe(24);
  });

  it("has a floor for something absurd", () => {
    expect(heroAmountSize("NPR 1,284,000,000,000")).toBe(20);
  });

  it("does not shrink a dash", () => {
    expect(heroAmountSize("—")).toBe(34);
  });
});

describe("heroPhotoUrl", () => {
  it("prefers the exterior — the shot that says which hostel this is", () => {
    expect(
      heroPhotoUrl(
        hostel({
          photos: [
            { alt: "", kind: "ROOM", roomType: "Single", url: "/api/v1/files/a/url" },
            { alt: "", kind: "EXTERIOR", roomType: "", url: "/api/v1/files/b/url" },
          ],
        }),
      ),
    ).toBe("/api/v1/files/b/url");
  });

  it("falls back to any photo at all", () => {
    expect(
      heroPhotoUrl(
        hostel({
          photos: [{ alt: "", kind: "INTERIOR", roomType: "", url: "/api/v1/files/c/url" }],
        }),
      ),
    ).toBe("/api/v1/files/c/url");
  });

  it("ignores rows whose url is blank", () => {
    // A photo record whose upload failed still exists with an empty url, and
    // an <Image> pointed at "" fetches the origin's root and decodes HTML.
    expect(
      heroPhotoUrl(hostel({ photos: [{ alt: "", kind: "EXTERIOR", roomType: "", url: "  " }] })),
    ).toBeNull();
  });

  it("is null for a warden with no single hostel", () => {
    expect(heroPhotoUrl(null)).toBeNull();
  });
});

describe("hostelAreaLabel", () => {
  it("joins the area and the city", () => {
    expect(hostelAreaLabel({ area: "Ghattekulo", city: "Kathmandu" })).toBe(
      "Ghattekulo, Kathmandu",
    );
  });

  it("does not say the same place twice", () => {
    expect(hostelAreaLabel({ area: "Pokhara", city: "Pokhara" })).toBe("Pokhara");
  });

  it("is null when nothing was set", () => {
    expect(hostelAreaLabel({ area: "  ", city: "" })).toBeNull();
    expect(hostelAreaLabel(null)).toBeNull();
  });
});

describe("listingState", () => {
  it("is live only when published and verified", () => {
    expect(listingState(hostel())).toEqual({ live: true, note: "Live on the site" });
  });

  it("separates the platform's hold from the owner's draft", () => {
    // One is fixed in the portal and the other cannot be; a single "not live"
    // badge would send half of them to a screen that cannot help.
    expect(listingState(hostel({ verificationStatus: "PENDING" })).note).toBe(
      "Awaiting verification",
    );
    expect(listingState(hostel({ status: "DRAFT" })).note).toBe("Not published yet");
  });

  it("says so when the account covers more than one hostel", () => {
    expect(listingState(null)).toEqual({ live: false, note: "No single listing" });
  });
});

describe("nightChips", () => {
  it("puts what needs a person first, regardless of count", () => {
    const chips = nightChips({
      INSIDE_HOSTEL: 39,
      NOT_VERIFIED: 4,
      OUTSIDE_HOSTEL: 2,
      SOS_TRIGGERED: 1,
    });

    expect(chips.map((chip) => chip.key)).toEqual([
      "SOS_TRIGGERED",
      "OUTSIDE_HOSTEL",
      "NOT_VERIFIED",
      "INSIDE_HOSTEL",
    ]);
  });

  it("drops the statuses nobody is in", () => {
    const chips = nightChips({ INSIDE_HOSTEL: 40, OUTSIDE_HOSTEL: 0, SOS_TRIGGERED: 0 });

    expect(chips).toEqual([
      { count: 40, key: "INSIDE_HOSTEL", label: "Inside", tone: "success" },
    ]);
  });

  it("shows a status it has never heard of rather than hiding it", () => {
    // The server owns this enum. A new member should read as an odd label, not
    // disappear from tonight's roster.
    expect(nightChips({ ON_LEAVE: 3 })).toEqual([
      { count: 3, key: "ON_LEAVE", label: "On leave", tone: "neutral" },
    ]);
  });

  it("is empty when there is no roster yet", () => {
    expect(nightChips(null)).toEqual([]);
    expect(nightChips({})).toEqual([]);
  });
});

describe("occupancyLine", () => {
  it("reads as a sentence of three figures", () => {
    expect(occupancyLine({ occupancy: 88, residents: 42, vacantBeds: 6 })).toBe(
      "42 residents · 6 beds free · 88% full",
    );
  });

  it("agrees with itself about number", () => {
    expect(occupancyLine({ occupancy: 50, residents: 1, vacantBeds: 1 })).toBe(
      "1 resident · 1 bed free · 50% full",
    );
  });

  it("drops occupancy rather than reporting zero for a hostel with no rooms set up", () => {
    // The tiles this replaced showed a dash for the same case. A dash cannot
    // come along here: `· — ·` mid-sentence reads as a rendering fault.
    expect(occupancyLine({ occupancy: null, residents: 42, vacantBeds: 0 })).toBe(
      "42 residents · 0 beds free",
    );
  });

  it("keeps a real zero occupancy, which is not the same fact", () => {
    expect(occupancyLine({ occupancy: 0, residents: 0, vacantBeds: 24 })).toBe(
      "0 residents · 24 beds free · 0% full",
    );
  });
});
