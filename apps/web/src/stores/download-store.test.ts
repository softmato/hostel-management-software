import { describe, expect, it } from "vitest";

import {
  type DownloadItem,
  downloadRate,
  isDownloadActive,
  type DownloadStatus,
} from "@/stores/download-store";

/**
 * The store's rules, not its React binding.
 *
 * The two worth pinning are both about **not knowing the size**: a streamed CSV
 * export sends no `Content-Length`, and every derived number has to stay honest
 * about that rather than dividing by zero and rendering a confident nonsense.
 */

function item(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    fileName: "payments-report.csv",
    id: "download-1",
    label: "Collection report",
    loadedBytes: 0,
    mimeType: "text/csv",
    percent: null,
    scope: "default",
    sizeBytes: 0,
    startedAt: 0,
    status: "downloading",
    ...overrides,
  };
}

describe("isDownloadActive", () => {
  it("counts saving as still in flight", () => {
    /*
     * A row parked on `saving` is the browser writing a large blob to disk —
     * still working, and treating it as finished would clear the card out from
     * under the user mid-write.
     */
    expect(isDownloadActive("saving")).toBe(true);
    expect(isDownloadActive("downloading")).toBe(true);
  });

  it("counts every terminal state as done", () => {
    const terminal: DownloadStatus[] = ["canceled", "error", "success"];

    expect(terminal.every((status) => isDownloadActive(status))).toBe(false);
  });
});

describe("downloadRate", () => {
  it("reports nothing until enough has happened to average over", () => {
    // Below the floor, the rate is one chunk divided by a rounding error.
    expect(downloadRate(item({ endedAt: 100, loadedBytes: 5_000 }))).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  it("averages over the whole transfer rather than the last chunk", () => {
    const rate = downloadRate(
      item({ endedAt: 2_000, loadedBytes: 400_000, sizeBytes: 1_000_000 }),
    );

    expect(rate.bytesPerSecond).toBe(200_000);
    expect(rate.etaSeconds).toBe(3);
  });

  it("refuses an ETA when the server never said how big the file is", () => {
    /*
     * The case this exists for. `sizeBytes` stays 0 for a streamed export, and
     * `(0 - loaded) / rate` would be a confident countdown to a number nobody
     * has — negative, at that. The speed is still real and still shown.
     */
    const rate = downloadRate(item({ endedAt: 2_000, loadedBytes: 400_000, sizeBytes: 0 }));

    expect(rate.bytesPerSecond).toBe(200_000);
    expect(rate.etaSeconds).toBeNull();
  });

  it("does not go negative when more arrived than was declared", () => {
    const rate = downloadRate(
      item({ endedAt: 2_000, loadedBytes: 1_200_000, sizeBytes: 1_000_000 }),
    );

    expect(rate.etaSeconds).toBe(0);
  });
});
