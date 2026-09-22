import { afterEach, describe, expect, it, vi } from "vitest";

import { progressResponse } from "@/lib/api-response";
import { browserApi } from "@/lib/browser-api";

const asking = () => new Request("http://app.test/x", { headers: { accept: "application/x-ndjson" } });

afterEach(() => vi.unstubAllGlobals());

describe("progressResponse ↔ browserApi(…, onStep)", () => {
  it("delivers each step as it starts, then the data", async () => {
    const response = await progressResponse(asking(), async (step) => {
      step("invoice");
      step("session");

      return { checkoutUrl: "https://pay.test/s/1" };
    });

    vi.stubGlobal("fetch", vi.fn(async () => response));

    const steps: string[] = [];

    await expect(browserApi("/x", { method: "POST" }, (s) => steps.push(s))).resolves.toEqual({
      checkoutUrl: "https://pay.test/s/1",
    });
    expect(steps).toEqual(["invoice", "session"]);
  });

  it("fails with the same message and code the JSON route would give", async () => {
    const response = await progressResponse(asking(), async (step) => {
      step("invoice");
      throw Object.assign(new Error("This invoice is already settled in full."), {
        errorCode: "ALREADY_SETTLED",
        status: 409,
      });
    });

    vi.stubGlobal("fetch", vi.fn(async () => response));

    await expect(browserApi("/x", {}, () => {})).rejects.toMatchObject({
      errorCode: "ALREADY_SETTLED",
      message: "This invoice is already settled in full.",
    });
  });

  it("answers the plain envelope to a caller that did not ask — the phone app", async () => {
    const response = await progressResponse(new Request("http://app.test/x"), async (step) => {
      step("invoice");

      return { ok: 1 };
    });

    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ data: { ok: 1 }, success: true });
  });
});
