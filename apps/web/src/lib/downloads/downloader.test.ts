import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadFile } from "@/lib/downloads/downloader";
import { useDownloadStore } from "@/stores/download-store";

/**
 * The runner, driven against a fake `fetch`.
 *
 * Node has no DOM, so the two browser calls the save step makes are stubbed
 * rather than switching this file to jsdom — the repo's tests are node-only by
 * config and the point here is the *state machine*, not the anchor click. What
 * the stubs do check is that the click happened with the right filename, which
 * is the one thing about the save worth asserting.
 */

/** Streams `chunks` back as a body, the way a real export route does. */
function streamingResponse(
  chunks: string[],
  { headers = {}, status = 200 }: { headers?: Record<string, string>; status?: number } = {},
) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
      }),
    },
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

let clicked: { download: string; href: string }[] = [];

beforeEach(() => {
  clicked = [];
  useDownloadStore.setState({ items: [] });

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => undefined,
  });

  vi.stubGlobal("document", {
    createElement: () => {
      const link = { click: () => clicked.push({ ...link }), download: "", href: "", rel: "" };

      return link;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadFile", () => {
  it("reports a percentage when the server declares a length", async () => {
    const seen: (number | null)[] = [];

    useDownloadStore.subscribe((state) => {
      const row = state.items[0];

      if (row) {
        seen.push(row.percent);
      }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse(["aaaaa", "bbbbb"], {
          headers: { "content-length": "10", "content-type": "text/csv" },
        }),
      ),
    );

    const outcome = await downloadFile({ fileName: "report.csv", url: "/api/export" });

    expect(outcome).toEqual({ ok: true });
    // Half way, then all the way — the readings the bar is drawn from.
    expect(seen).toContain(50);
    expect(seen).toContain(100);
  });

  it("stays indeterminate when the server streams without a length", async () => {
    /*
     * The case this whole nullable-percent design exists for: a streamed CSV
     * export sends no `Content-Length`, and a bar pinned at 0 while bytes are
     * visibly arriving is what makes people click Export a second time.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(["aaaaa"], { headers: { "content-type": "text/csv" } })),
    );

    let midFlight: number | null | undefined;

    useDownloadStore.subscribe((state) => {
      const row = state.items[0];

      if (row?.status === "downloading" && row.loadedBytes > 0) {
        midFlight = row.percent;
      }
    });

    await downloadFile({ fileName: "report.csv", url: "/api/export" });

    expect(midFlight).toBeNull();
  });

  it("hands the assembled file to the browser under the name asked for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamingResponse(["hello"], { headers: { "content-type": "text/csv" } })),
    );

    await downloadFile({ fileName: "payments-report.csv", url: "/api/export" });

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("payments-report.csv");
    expect(useDownloadStore.getState().items[0].status).toBe("success");
  });

  it("turns a refused session into a sentence rather than a JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamingResponse([], { status: 403 })));

    const outcome = await downloadFile({ fileName: "report.csv", url: "/api/export" });

    expect(outcome).toEqual({
      error: "You are not signed in, or this is not yours to download.",
      ok: false,
    });
    expect(useDownloadStore.getState().items[0].status).toBe("error");
    // Nothing was saved — the failure must not leave a file of an error page.
    expect(clicked).toHaveLength(0);
  });

  it("names the status for any other server failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamingResponse([], { status: 500 })));

    const outcome = await downloadFile({ fileName: "report.csv", url: "/api/export" });

    expect(outcome).toEqual({
      error: "The server could not produce this file (500).",
      ok: false,
    });
  });

  it("marks an aborted transfer canceled rather than failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );

    const outcome = await downloadFile({ fileName: "report.csv", url: "/api/export" });

    expect(outcome.ok).toBe(false);
    expect(useDownloadStore.getState().items[0].status).toBe("canceled");
  });

  it("never throws, whatever the network does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network is down.");
      }),
    );

    await expect(
      downloadFile({ fileName: "report.csv", url: "/api/export" }),
    ).resolves.toEqual({ error: "Network is down.", ok: false });
  });
});
