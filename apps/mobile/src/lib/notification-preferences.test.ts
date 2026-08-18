import { describe, expect, it } from "vitest";

import {
  describePreference,
  formatMinutes,
  MUTABLE_CATEGORIES,
  type NotificationPreference,
  parseMinutes,
} from "@/lib/notification-preferences";

const base: NotificationPreference = {
  mutedCategories: [],
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursEnd: 7 * 60,
  quietHoursStart: 22 * 60,
  timeZone: "Asia/Kathmandu",
};

describe("formatMinutes", () => {
  it("renders a clock face", () => {
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(7 * 60)).toBe("07:00");
    expect(formatMinutes(22 * 60 + 30)).toBe("22:30");
    expect(formatMinutes(23 * 60 + 59)).toBe("23:59");
  });

  it("wraps rather than rendering a 24th hour", () => {
    expect(formatMinutes(1440)).toBe("00:00");
    expect(formatMinutes(-60)).toBe("23:00");
  });
});

describe("parseMinutes", () => {
  it("reads a typed time", () => {
    expect(parseMinutes("08:05")).toBe(485);
    expect(parseMinutes("8:05")).toBe(485);
    expect(parseMinutes(" 22:30 ")).toBe(1350);
  });

  it("rejects anything that is not a time", () => {
    // The field is free text on the phone, so this is the only thing standing
    // between a typo and a PATCH the server answers with a 400.
    expect(parseMinutes("25:00")).toBeNull();
    expect(parseMinutes("12:60")).toBeNull();
    expect(parseMinutes("1230")).toBeNull();
    expect(parseMinutes("half ten")).toBeNull();
    expect(parseMinutes("")).toBeNull();
  });
});

describe("describePreference", () => {
  it("says urgent still gets through when push is off", () => {
    // The whole point of the sentence: someone who believes they have silenced
    // their phone and has not is worse off than someone never offered the switch.
    expect(describePreference({ ...base, pushEnabled: false })).toContain("Urgent");
  });

  it("summarises quiet hours and mutes together", () => {
    expect(
      describePreference({
        ...base,
        mutedCategories: ["COMMUNITY", "FOOD"],
        quietHoursEnabled: true,
      }),
    ).toBe("Quiet 22:00–07:00 · 2 types muted");
  });

  it("singularises one muted type", () => {
    expect(describePreference({ ...base, mutedCategories: ["FOOD"] })).toBe(
      "1 type muted",
    );
  });

  it("says so plainly when nothing is restricted", () => {
    expect(describePreference(base)).toBe("You get everything, at any hour");
  });
});

describe("MUTABLE_CATEGORIES", () => {
  it("never offers to mute SOS", () => {
    // The server overrides any mute for urgent alerts, so a switch here would be
    // a control that silently does nothing — a lie told in a settings screen.
    expect(MUTABLE_CATEGORIES.map((row) => row.value)).not.toContain("SOS");
    expect(MUTABLE_CATEGORIES.map((row) => row.value)).not.toContain("URGENT");
  });
});
