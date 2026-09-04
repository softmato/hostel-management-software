import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearQueryCache,
  defineQuery,
  fetchQuery,
  invalidateQuery,
  prefetchQuery,
  readQuery,
  resetQueryCache,
  subscribeQuery,
  writeQuery,
} from "@/lib/query-cache";
import { publishTopics } from "@/lib/resource-bus";

afterEach(() => {
  resetQueryCache();
  vi.useRealTimers();
});

describe("reading and writing", () => {
  it("hands back what was written, as fresh", () => {
    writeQuery("admin:residents", [{ id: "r1" }]);

    expect(readQuery("admin:residents")).toEqual({
      data: [{ id: "r1" }],
      fresh: true,
    });
  });

  it("is a miss for a key nobody has written", () => {
    expect(readQuery("admin:residents")).toBeNull();
  });

  it("keeps the same object, so a re-render can be skipped", () => {
    const rows = [{ id: "r1" }];
    writeQuery("admin:residents", rows);

    expect(readQuery<typeof rows>("admin:residents")?.data).toBe(rows);
  });
});

describe("freshness", () => {
  it("goes stale past staleMs but stays showable", () => {
    vi.useFakeTimers();
    writeQuery("admin:today", { notices: [] });

    vi.advanceTimersByTime(45_000);

    expect(readQuery("admin:today")).toEqual({ data: { notices: [] }, fresh: false });
  });

  /*
   * The distinction the whole two-number scheme exists for: past `maxAgeMs` the
   * screen must not paint the figure at all, so the read has to miss rather than
   * come back stale.
   */
  it("is a miss past maxAgeMs", () => {
    vi.useFakeTimers();
    writeQuery("admin:money:2082-05", { invoices: [] });

    vi.advanceTimersByTime(6 * 60_000);

    expect(readQuery("admin:money:2082-05")).toBeNull();
  });

  it("treats a re-write as a new answer", () => {
    vi.useFakeTimers();
    writeQuery("admin:today", { notices: [] });
    vi.advanceTimersByTime(45_000);
    writeQuery("admin:today", { notices: ["n1"] });

    expect(readQuery("admin:today")?.fresh).toBe(true);
  });
});

describe("invalidation", () => {
  it("marks an entry stale without dropping it", () => {
    writeQuery("admin:residents", [{ id: "r1" }]);
    invalidateQuery("admin:residents");

    expect(readQuery("admin:residents")).toEqual({ data: [{ id: "r1" }], fresh: false });
  });

  /*
   * The reason entries carry their topics: this covers the four tabs that are
   * *not* mounted, which `use-resource`'s own subscription cannot reach.
   */
  it("stales every entry reading a published topic", () => {
    writeQuery("admin:residents", [], ["residents"]);
    writeQuery("admin:today", {}, ["notices"]);

    publishTopics(["residents"]);

    expect(readQuery("admin:residents")?.fresh).toBe(false);
    expect(readQuery("admin:today")?.fresh).toBe(true);
  });

  it("leaves an entry with no topics alone", () => {
    writeQuery("admin:hostel", { name: "Sunrise" });

    publishTopics(["residents", "payments"]);

    expect(readQuery("admin:hostel")?.fresh).toBe(true);
  });
});

describe("subscriptions", () => {
  it("tells watchers of a key when it is written", () => {
    const listener = vi.fn();
    subscribeQuery("admin:hostel", listener);

    writeQuery("admin:hostel", { name: "Sunrise" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves watchers of other keys alone", () => {
    const listener = vi.fn();
    subscribeQuery("admin:hostel", listener);

    writeQuery("admin:residents", []);

    expect(listener).not.toHaveBeenCalled();
  });

  /*
   * Invalidation is not something to re-render: the data on screen has not
   * changed, only the question of whether to ask again.
   */
  it("says nothing on an invalidation", () => {
    writeQuery("admin:hostel", { name: "Sunrise" });
    const listener = vi.fn();
    subscribeQuery("admin:hostel", listener);

    publishTopics(["residents"]);
    invalidateQuery("admin:hostel");

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops after unsubscribing", () => {
    const listener = vi.fn();
    subscribeQuery("admin:hostel", listener)();

    writeQuery("admin:hostel", {});

    expect(listener).not.toHaveBeenCalled();
  });

  it("carries on when one watcher throws", () => {
    const second = vi.fn();
    subscribeQuery("admin:hostel", () => {
      throw new Error("render failed");
    });
    subscribeQuery("admin:hostel", second);

    writeQuery("admin:hostel", {});

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("fetchQuery", () => {
  it("files the result under the key", async () => {
    await fetchQuery("admin:residents", async () => [{ id: "r1" }], ["residents"]);

    expect(readQuery("admin:residents")?.data).toEqual([{ id: "r1" }]);
  });

  /*
   * The warm-up fires while Home is already asking for two of the same reads.
   * Without this that is the request storm, one frame early.
   */
  it("joins a request already in flight instead of starting a second", async () => {
    const load = vi.fn(async () => [{ id: "r1" }]);

    const [first, second] = await Promise.all([
      fetchQuery("admin:residents", load),
      fetchQuery("admin:residents", load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("asks again once the first request has settled", async () => {
    const load = vi.fn(async () => []);

    await fetchQuery("admin:residents", load);
    await fetchQuery("admin:residents", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not file a failure over a good answer", async () => {
    writeQuery("admin:residents", [{ id: "r1" }]);

    await expect(
      fetchQuery("admin:residents", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");

    expect(readQuery("admin:residents")?.data).toEqual([{ id: "r1" }]);
  });
});

describe("prefetchQuery", () => {
  it("warms a key nobody has read yet", async () => {
    prefetchQuery("admin:roll-call", async () => ({ night: null }));
    await vi.waitFor(() => expect(readQuery("admin:roll-call")).not.toBeNull());
  });

  it("does not re-ask a question whose answer is still fresh", () => {
    writeQuery("admin:roll-call", { night: null });
    const load = vi.fn(async () => ({ night: null }));

    prefetchQuery("admin:roll-call", load);

    expect(load).not.toHaveBeenCalled();
  });

  it("does re-ask once the answer has gone stale", () => {
    vi.useFakeTimers();
    writeQuery("admin:roll-call", { night: null });
    vi.advanceTimersByTime(45_000);
    const load = vi.fn(async () => ({ night: null }));

    prefetchQuery("admin:roll-call", load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  /*
   * A warden without `viewPayments` is refused half the warm-up. Nobody is
   * awaiting these, so a rejection that escaped would be an unhandled one.
   */
  it("swallows a refusal", async () => {
    prefetchQuery("admin:money:2082-05", async () => {
      throw new Error("403");
    });

    await Promise.resolve();
    expect(readQuery("admin:money:2082-05")).toBeNull();
  });
});

describe("clearQueryCache", () => {
  it("leaves nothing of the departing account behind", () => {
    writeQuery("admin:residents", [{ id: "r1" }]);

    clearQueryCache();

    expect(readQuery("admin:residents")).toBeNull();
  });

  it("keeps watchers subscribed for whoever signs in next", () => {
    const listener = vi.fn();
    subscribeQuery("admin:residents", listener);

    clearQueryCache();
    writeQuery("admin:residents", []);

    // Once for the clear, once for the write.
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("defineQuery", () => {
  /*
   * The identity guarantee `useResource` depends on. A registry returning a new
   * object — and so a new `load` — on every render would make every screen built
   * on it fetch in a loop.
   */
  it("hands back the same object for the same key", () => {
    const first = defineQuery("admin:residents", ["residents"], async () => []);
    const second = defineQuery("admin:residents", ["residents"], async () => []);

    expect(second).toBe(first);
    expect(second.load).toBe(first.load);
  });

  it("keeps different keys apart", () => {
    const may = defineQuery("admin:money:2082-01", [], async () => "may");
    const june = defineQuery("admin:money:2082-02", [], async () => "june");

    expect(june).not.toBe(may);
  });

  /*
   * The trap the "pure in its key" rule exists for, pinned so it stays a rule:
   * an argument that does not reach the key is frozen at whatever the first
   * caller passed.
   */
  it("ignores a later loader for a key it already knows", async () => {
    defineQuery("admin:money:2082-01", [], async () => "first");
    const again = defineQuery("admin:money:2082-01", [], async () => "second");

    await expect(again.load()).resolves.toBe("first");
  });
});
