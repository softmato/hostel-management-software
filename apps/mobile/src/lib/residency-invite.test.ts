import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: {} }));

import { inviteRentLine } from "@/lib/residency-invite";

describe("the residency invite sheet", () => {
  it("says what is due, or that rent is all clear", () => {
    expect(inviteRentLine({ dueAmount: 26500, paidTill: "Bhadra 2083" })).toBe("Rs 26,500 due");
    expect(inviteRentLine({ dueAmount: 0, paidTill: "Aswin 2083" })).toBe("All clear till Aswin 2083");
    expect(inviteRentLine({ dueAmount: 0, paidTill: null })).toBe("All clear");
  });
});
