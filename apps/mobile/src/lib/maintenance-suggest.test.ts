import { describe, expect, it } from "vitest";

import {
  categoryForRole,
  providerRoleLabel,
  suggestPriority,
  suggestProviderRole,
  suggestProviderRoles,
  titleFromProblem,
} from "@/lib/maintenance-suggest";

describe("suggestProviderRoles", () => {
  it("reads a plumbing job out of an ordinary sentence", () => {
    const [top] = suggestProviderRoles("the tap in room 204 is leaking");

    expect(top?.role).toBe("PLUMBER");
    expect(top?.category).toBe("PLUMBING");
  });

  it("prefers the role with the strongest evidence, not the first rule", () => {
    // "light" alone is a weak electrical term; "wifi" and "router" are strong
    // internet ones, so the internet rule has to win despite coming later.
    const [top] = suggestProviderRoles("the wifi router near the light is dead");

    expect(top?.role).toBe("INTERNET_TECHNICIAN");
  });

  it("says nothing rather than guessing at an empty box", () => {
    expect(suggestProviderRoles("")).toEqual([]);
    expect(suggestProviderRoles("ok")).toEqual([]);
    expect(suggestProviderRole("qwerty asdf")).toBeUndefined();
  });
});

describe("suggestPriority", () => {
  it("hears an emergency", () => {
    expect(suggestPriority("sparks from the socket, urgent")).toBe("URGENT");
  });

  it("hears a bad-but-not-dangerous problem", () => {
    expect(suggestPriority("no water since morning")).toBe("HIGH");
  });

  it("defaults to the middle", () => {
    expect(suggestPriority("please repaint the corridor sometime")).toBe("MEDIUM");
  });
});

describe("titleFromProblem", () => {
  it("takes the first line", () => {
    expect(titleFromProblem("Tap leaking\nSecond floor, since Tuesday")).toBe(
      "Tap leaking",
    );
  });

  it("caps at what the title field accepts", () => {
    // The server's `title` is 2–180 characters, so a pasted paragraph has to be
    // trimmed here rather than rejected on submit.
    expect(titleFromProblem("x".repeat(400))).toHaveLength(180);
  });
});

describe("categoryForRole and providerRoleLabel", () => {
  it("pairs a role with the category the request should carry", () => {
    expect(categoryForRole("ELECTRICIAN")).toBe("ELECTRICAL");
    expect(categoryForRole("DOCTOR_CLINIC")).toBe("HEALTH");
  });

  it("falls back to OTHER for a role with no rule", () => {
    expect(categoryForRole("OTHER")).toBe("OTHER");
  });

  it("labels a role the way a person says it", () => {
    expect(providerRoleLabel("DOCTOR_CLINIC")).toBe("Doctor / Clinic");
    expect(providerRoleLabel("SOMETHING_NEW")).toBe("SOMETHING NEW");
  });
});
