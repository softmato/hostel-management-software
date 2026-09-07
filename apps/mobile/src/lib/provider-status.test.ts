import { describe, expect, it } from "vitest";

import type { ProviderApplication } from "@/lib/provider-api";
import {
  isApplicationInFlight,
  PROVIDER_REVIEW_WINDOW,
  providerStatusPanel,
} from "@/lib/provider-status";

function application(
  overrides: Partial<ProviderApplication> = {},
): ProviderApplication {
  return {
    area: "Baneshwor",
    availability: "Mornings",
    categories: ["PLUMBER"],
    category: "PLUMBER",
    city: "Kathmandu",
    description: "",
    documentCount: 3,
    email: "ram@example.com",
    experience: "6 years",
    fullName: "Ram Bahadur",
    id: "p-1",
    phone: "9812345678",
    rejectionReason: "",
    status: "PENDING_APPROVAL",
    ...overrides,
  };
}

describe("providerStatusPanel", () => {
  it("offers the form to an account that has never applied", () => {
    const panel = providerStatusPanel(null);

    expect(panel.canApply).toBe(true);
    expect(panel.showJobs).toBe(false);
  });

  /*
   * The whole point of the pending panel: an applicant who has handed over their
   * documents wants to know how long the check takes, and the number has to be
   * the one every other surface quotes.
   */
  it("tells a waiting applicant how long verification takes", () => {
    const panel = providerStatusPanel(application());

    expect(panel.body).toContain(PROVIDER_REVIEW_WINDOW);
    expect(panel.tone).toBe("warning");
  });

  /*
   * `registerPublicServiceProvider` answers 409 for an active application, so a
   * screen that offered the form here would be offering a refusal.
   */
  it("does not offer the form while an application is in review", () => {
    expect(providerStatusPanel(application()).canApply).toBe(false);
  });

  it("does not offer the form to an approved provider, and points at the work", () => {
    const panel = providerStatusPanel(application({ status: "APPROVED" }));

    expect(panel.canApply).toBe(false);
    expect(panel.showJobs).toBe(true);
  });

  /*
   * "Not approved" with no reason is the state people write to support about.
   */
  it("carries the rejection reason into the body", () => {
    const panel = providerStatusPanel(
      application({
        rejectionReason: "The trade licence photo was unreadable.",
        status: "REJECTED",
      }),
    );

    expect(panel.body).toContain("The trade licence photo was unreadable.");
    expect(panel.canApply).toBe(true);
  });

  it("falls back to the plain rejection copy when no reason was recorded", () => {
    const panel = providerStatusPanel(application({ status: "REJECTED" }));

    expect(panel.canApply).toBe(true);
    expect(panel.body).toContain("wasn't approved");
  });

  it.each(["HIDDEN", "INACTIVE"] as const)(
    "keeps a %s listing out of both the form and the job list",
    (status) => {
      const panel = providerStatusPanel(application({ status }));

      expect(panel.canApply).toBe(false);
      expect(panel.showJobs).toBe(false);
    },
  );

  /*
   * No screen in the app promises broadcast work — jobs are assigned to a
   * provider by name by a hostel admin, and a marketplace that does not exist
   * must not be advertised to somebody deciding whether to apply.
   */
  it("never promises broadcast jobs", () => {
    const bodies = (
      [
        null,
        application(),
        application({ status: "APPROVED" }),
        application({ status: "HIDDEN" }),
        application({ status: "INACTIVE" }),
        application({ status: "REJECTED" }),
      ] as const
    ).map((record) => providerStatusPanel(record).body);

    for (const body of bodies) {
      expect(body.toLowerCase()).not.toContain("broadcast");
    }
  });
});

describe("isApplicationInFlight", () => {
  it("is false with no application", () => {
    expect(isApplicationInFlight(null)).toBe(false);
  });

  /*
   * An approved provider is routed to their own tabs and never sees the banner
   * this predicate gates, so reporting on them there would be noise on a screen
   * they do not open.
   */
  it("is false once approved", () => {
    expect(isApplicationInFlight(application({ status: "APPROVED" }))).toBe(false);
  });

  it.each(["PENDING_APPROVAL", "REJECTED", "HIDDEN", "INACTIVE"] as const)(
    "is true for %s",
    (status) => {
      expect(isApplicationInFlight(application({ status }))).toBe(true);
    },
  );
});
