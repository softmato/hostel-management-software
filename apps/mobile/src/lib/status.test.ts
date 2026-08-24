import { describe, expect, it } from "vitest";

import { statusTone } from "@/lib/status";

/**
 * The table exists because substring matching gets these exact cases wrong.
 */
describe("statusTone", () => {
  it("does not read UNPAID as PAID", () => {
    // `"UNPAID".includes("PAID")` is true, which is how an unpaid invoice ends
    // up green on a screen whose whole job is telling someone they owe money.
    expect(statusTone("PAID")).toBe("success");
    expect(statusTone("UNPAID")).toBe("danger");
  });

  it("keeps a claimed-but-unverified payment amber", () => {
    // The resident has said they paid; the hostel has not agreed. Green here
    // is how somebody concludes they are settled and stops chasing it.
    expect(statusTone("PENDING_PROOF")).toBe("warning");
    expect(statusTone("PARTIAL")).toBe("warning");
  });

  it("flags an unbilled resident rather than greying them out", () => {
    // `NOT_BILLED` is the invoice matrix's word for "nobody charged this
    // resident this month". Neutral would read as a settled or irrelevant row;
    // it is the one state with nothing chasing it at all.
    expect(statusTone("NOT_BILLED")).toBe("warning");
  });

  it("falls back to neutral for an enum nobody mapped", () => {
    expect(statusTone("SOME_NEW_SERVER_STATUS")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
  });

  it("tolerates casing and padding from the wire", () => {
    expect(statusTone(" overdue ")).toBe("danger");
  });
});
