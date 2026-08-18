import { describe, expect, it } from "vitest";

import type { ProviderJob } from "@/lib/provider-api";
import {
  isOpenJob,
  jobActions,
  jobAddress,
  openJobCount,
  sortProviderJobs,
} from "@/lib/provider-jobs";

function job(overrides: Partial<ProviderJob> = {}): ProviderJob {
  return {
    category: "PLUMBING",
    createdAt: "2026-08-10T10:00:00.000Z",
    description: "",
    hostelArea: "Baneshwor",
    hostelCity: "Kathmandu",
    hostelName: "Sunrise Hostel",
    hostelPhone: "9812345678",
    id: "j-1",
    location: "Room 204",
    priority: "MEDIUM",
    scheduledFor: null,
    status: "PENDING",
    title: "Leaking tap",
    ...overrides,
  };
}

describe("sortProviderJobs", () => {
  /*
   * The server returns newest-created first, which is right for an audit list
   * and wrong for somebody standing outside a building deciding what to do.
   */
  it("puts open work above closed work", () => {
    const sorted = sortProviderJobs([
      job({ id: "done", status: "COMPLETED" }),
      job({ id: "open", status: "PENDING" }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["open", "done"]);
  });

  it("orders open work by when it is due", () => {
    const sorted = sortProviderJobs([
      job({ id: "friday", scheduledFor: "2026-08-21T04:00:00.000Z", status: "SCHEDULED" }),
      job({ id: "today", scheduledFor: "2026-08-17T04:00:00.000Z", status: "SCHEDULED" }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["today", "friday"]);
  });

  /*
   * A date is a commitment; urgency within a day is a tiebreak. So Friday's
   * URGENT job does not jump ahead of today's LOW one.
   */
  it("does not let urgency outrank a nearer commitment", () => {
    const sorted = sortProviderJobs([
      job({
        id: "friday-urgent",
        priority: "URGENT",
        scheduledFor: "2026-08-21T04:00:00.000Z",
        status: "SCHEDULED",
      }),
      job({
        id: "today-low",
        priority: "LOW",
        scheduledFor: "2026-08-17T04:00:00.000Z",
        status: "SCHEDULED",
      }),
    ]);

    expect(sorted[0]?.id).toBe("today-low");
  });

  it("breaks a tie on the same day by urgency", () => {
    const sorted = sortProviderJobs([
      job({ id: "low", priority: "LOW", scheduledFor: "2026-08-17T04:00:00.000Z" }),
      job({ id: "urgent", priority: "URGENT", scheduledFor: "2026-08-17T04:00:00.000Z" }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["urgent", "low"]);
  });

  it("falls back to created date when nothing is scheduled", () => {
    const sorted = sortProviderJobs([
      job({ createdAt: "2026-08-15T10:00:00.000Z", id: "newer" }),
      job({ createdAt: "2026-08-02T10:00:00.000Z", id: "older" }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["older", "newer"]);
  });

  it("sinks a job with no usable date rather than floating it to the top", () => {
    const sorted = sortProviderJobs([
      job({ createdAt: null, id: "undated", scheduledFor: null }),
      job({ id: "dated" }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(["dated", "undated"]);
  });

  it("leaves an empty list alone", () => {
    expect(sortProviderJobs([])).toEqual([]);
  });
});

describe("jobActions", () => {
  /*
   * Saying "contacted" twice is not a state change, and a button that no-ops
   * teaches people to distrust the one beside it.
   */
  it("offers Contacted only from PENDING", () => {
    expect(jobActions(job({ status: "PENDING" })).canContact).toBe(true);
    expect(jobActions(job({ status: "CONTACTED" })).canContact).toBe(false);
    expect(jobActions(job({ status: "SCHEDULED" })).canContact).toBe(false);
  });

  it("offers Complete from every open status and none of the closed ones", () => {
    expect(jobActions(job({ status: "PENDING" })).canComplete).toBe(true);
    expect(jobActions(job({ status: "SCHEDULED" })).canComplete).toBe(true);
    expect(jobActions(job({ status: "COMPLETED" })).canComplete).toBe(false);
    expect(jobActions(job({ status: "CANCELLED" })).canComplete).toBe(false);
  });
});

describe("jobAddress", () => {
  it("reads from the most specific part outward", () => {
    expect(jobAddress(job())).toBe("Room 204, Sunrise Hostel, Baneshwor, Kathmandu");
  });

  it("drops the parts the hostel never filled in", () => {
    expect(jobAddress(job({ hostelArea: "", location: "" }))).toBe(
      "Sunrise Hostel, Kathmandu",
    );
  });
});

describe("openJobCount", () => {
  it("counts only work that is still open", () => {
    expect(
      openJobCount([job(), job({ status: "COMPLETED" }), job({ status: "SCHEDULED" })]),
    ).toBe(2);
    expect(isOpenJob(job({ status: "CANCELLED" }))).toBe(false);
  });
});
