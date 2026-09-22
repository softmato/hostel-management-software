import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform-config/site-config.service", () => ({
  getSiteConfigSection: async () => ({ plans: [{ id: "go" }, { id: "pro" }] }),
}));

import { planAfterPayment } from "./subscription.service";

describe("planAfterPayment", () => {
  it("adds a lower or shorter purchase to the plan held", async () => {
    expect(await planAfterPayment({ cycleMonths: 12, planId: "go" }, { cycleMonths: 1, planId: "go" })).toBe("current");
    expect(await planAfterPayment({ cycleMonths: 1, planId: "pro" }, { cycleMonths: 12, planId: "go" })).toBe("current");
  });

  it("switches to a higher plan or a longer cycle of the same one", async () => {
    expect(await planAfterPayment({ cycleMonths: 12, planId: "go" }, { cycleMonths: 1, planId: "pro" })).toBe("invoice");
    expect(await planAfterPayment({ cycleMonths: 1, planId: "go" }, { cycleMonths: 12, planId: "go" })).toBe("invoice");
    expect(await planAfterPayment({ planId: null }, { cycleMonths: 1, planId: "go" })).toBe("invoice");
  });
});
