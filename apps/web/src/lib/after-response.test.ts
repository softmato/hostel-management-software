import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The helper that decides whether a side effect actually happens.
 *
 * Worth its own file because the failure it exists to prevent is invisible: a
 * `void promise()` in a route handler produces no error, no log and no failed
 * request — only a phone that never buzzes. Nothing about the call site looks
 * wrong, which is why it survived in production across every notification the
 * product raises.
 */
const mocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("next/server", () => ({ after: mocks.after }));

import { afterResponse } from "@/lib/after-response";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inside a request", () => {
  it("hands the work to the platform instead of running it now", async () => {
    // The point of the whole helper: the response goes out first, and the
    // invocation is kept alive until this has finished.
    const work = vi.fn().mockResolvedValue("sent");

    afterResponse(work);

    expect(mocks.after).toHaveBeenCalledOnce();
    expect(work).not.toHaveBeenCalled();

    await mocks.after.mock.calls[0]![0]();

    expect(work).toHaveBeenCalledOnce();
  });

  it("swallows a rejection rather than surfacing it after the response", async () => {
    afterResponse(() => Promise.reject(new Error("expo is down")));

    await expect(mocks.after.mock.calls[0]![0]()).resolves.toBeUndefined();
  });
});

describe("outside a request", () => {
  beforeEach(() => {
    // A cron, a script, a test: `after()` throws, and there is no response to
    // run behind anyway.
    mocks.after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
  });

  it("runs the work immediately instead of dropping it", () => {
    const work = vi.fn().mockResolvedValue(undefined);

    afterResponse(work);

    expect(work).toHaveBeenCalledOnce();
  });

  it("does not let the work's failure escape into the caller", () => {
    expect(() =>
      afterResponse(() => {
        throw new Error("thrown before any promise exists");
      }),
    ).not.toThrow();
  });

  it("accepts a callback that returns nothing at all", () => {
    // Every test double of a notifier is this shape, and an earlier version
    // called `.catch` on the result — which took the whole intake down.
    expect(() => afterResponse(() => undefined)).not.toThrow();
  });
});
