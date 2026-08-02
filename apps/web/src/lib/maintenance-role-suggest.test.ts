import { describe, expect, it } from "vitest";

import {
  categoryForRole,
  suggestPriority,
  suggestProviderRole,
  suggestProviderRoles,
  titleFromProblem,
} from "@/lib/maintenance-role-suggest";

describe("suggestProviderRole", () => {
  it("reads the trade out of a plain-language problem", () => {
    expect(suggestProviderRole("Tap in room 204 is leaking since morning")?.role).toBe(
      "PLUMBER",
    );
    expect(
      suggestProviderRole("Switch board sparking, no power in 3rd floor")?.role,
    ).toBe("ELECTRICIAN");
    expect(suggestProviderRole("Wifi router keeps dropping")?.role).toBe(
      "INTERNET_TECHNICIAN",
    );
    expect(suggestProviderRole("Cupboard door hinge broken")?.role).toBe("CARPENTER");
    expect(suggestProviderRole("Resident has high fever, need a doctor")?.role).toBe(
      "DOCTOR_CLINIC",
    );
  });

  it("returns nothing for text with no recognisable keyword", () => {
    expect(suggestProviderRoles("hmm")).toEqual([]);
    expect(suggestProviderRole("something is odd upstairs")).toBeUndefined();
  });

  it("ranks the strongest trade first and reports what matched", () => {
    const [top] = suggestProviderRoles("bathroom pipe leaking onto the wall");

    expect(top.role).toBe("PLUMBER");
    expect(top.matched).toContain("leaking");
    expect(top.category).toBe("PLUMBING");
  });
});

describe("suggestPriority", () => {
  it("escalates on urgency words", () => {
    expect(suggestPriority("Short circuit in kitchen, urgent")).toBe("URGENT");
    expect(suggestPriority("Fan not working in room 12")).toBe("HIGH");
    expect(suggestPriority("Repaint the corridor before Dashain")).toBe("MEDIUM");
  });
});

describe("categoryForRole and titleFromProblem", () => {
  it("maps a role to its maintenance category", () => {
    expect(categoryForRole("ELECTRICIAN")).toBe("ELECTRICAL");
    expect(categoryForRole("WATER_SUPPLIER")).toBe("WATER");
    expect(categoryForRole("")).toBe("OTHER");
  });

  it("uses the first line as the request title and clamps the length", () => {
    expect(titleFromProblem("Leaking tap\nSince yesterday morning")).toBe("Leaking tap");
    expect(titleFromProblem("x".repeat(300))).toHaveLength(180);
  });
});
