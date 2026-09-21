import { describe, expect, it } from "vitest";

import { hostelCode, normalizeHostelCode } from "@/lib/hostel-code";

describe("hostel code", () => {
  it("reads the last eight hex digits of the id as HH-XXXXXXXX, as the app does", () => {
    expect(hostelCode("66f0c2a1b7e4d93f9a1c2e4b")).toBe("HH-9A1C2E4B");
  });

  it("accepts the ID however it was typed", () => {
    for (const typed of ["HH-9A1C2E4B", "HH-9A1C-2E4B", "hh 9a1c 2e4b", "HH9A1C2E4B", "9a1c-2e4b"]) {
      expect(normalizeHostelCode(typed)).toBe("HH-9A1C2E4B");
    }
  });

  it("rejects anything that is not eight hex digits", () => {
    expect(normalizeHostelCode("HH-4K7M-9XQ2")).toBe("");
    expect(normalizeHostelCode("HH-9A1C")).toBe("");
  });
});
