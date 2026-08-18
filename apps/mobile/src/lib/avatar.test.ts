import { describe, expect, it } from "vitest";

import { avatarInitial, avatarToneIndex } from "@/lib/avatar";

describe("avatarInitial", () => {
  it("uppercases the first character", () => {
    expect(avatarInitial("sita sharma")).toBe("S");
  });

  it("ignores leading whitespace rather than rendering a blank circle", () => {
    expect(avatarInitial("   ram")).toBe("R");
  });

  it("falls back for an empty or missing name", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
    expect(avatarInitial(undefined)).toBe("?");
  });

  it("keeps a digit, because hostel names start with them", () => {
    expect(avatarInitial("7 Hills Hostel")).toBe("7");
  });
});

describe("avatarToneIndex", () => {
  it("is stable for the same name", () => {
    expect(avatarToneIndex("Sita Sharma", 5)).toBe(avatarToneIndex("Sita Sharma", 5));
  });

  it("stays inside the table", () => {
    for (const name of ["a", "Sita", "Ram Bahadur", "7 Hills", "ऋषि"]) {
      const index = avatarToneIndex(name, 5);

      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
    }
  });

  it("does not go negative on a long name that overflows 32 bits", () => {
    expect(avatarToneIndex("z".repeat(200), 5)).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 rather than NaN when there is no table", () => {
    expect(avatarToneIndex("Sita", 0)).toBe(0);
  });

  it("treats a missing name as the empty name", () => {
    expect(avatarToneIndex(null, 5)).toBe(avatarToneIndex("", 5));
  });
});
