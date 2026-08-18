import { beforeEach, describe, expect, it } from "vitest";

import {
  dismissUpload,
  FAILURE_LINGER_MS,
  finishUpload,
  getUploadRows,
  isUploadActive,
  pruneUploads,
  resetUploadQueue,
  startUpload,
  SUCCESS_LINGER_MS,
  subscribeToUploads,
  sweepUploads,
  updateUpload,
  uploadRowFraction,
  uploadRowMessage,
  type UploadRow,
} from "@/lib/upload-queue";

function row(overrides: Partial<UploadRow> = {}): UploadRow {
  return {
    endedAt: null,
    error: null,
    fraction: 0,
    id: "upload-1",
    label: "Payment proof",
    stage: "uploading",
    startedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetUploadQueue();
});

describe("uploadRowMessage", () => {
  it("names the stage the user is waiting on, not the HTTP call", () => {
    expect(uploadRowMessage(row({ stage: "presigning" }))).toBe("Preparing…");
    expect(uploadRowMessage(row({ stage: "verifying" }))).toBe("Checking the file…");
    expect(uploadRowMessage(row({ endedAt: 1, stage: "succeeded" }))).toBe("Uploaded");
  });

  it("shows a percentage only when the size is known", () => {
    expect(uploadRowMessage(row({ fraction: 0.426 }))).toBe("Uploading 43%");
    expect(uploadRowMessage(row({ fraction: null }))).toBe("Uploading…");
  });

  it("shows the failure reason rather than a generic message when there is one", () => {
    expect(uploadRowMessage(row({ error: "Storage refused it.", stage: "failed" }))).toBe(
      "Storage refused it.",
    );
    expect(uploadRowMessage(row({ stage: "failed" }))).toBe("Upload failed.");
  });
});

describe("uploadRowFraction", () => {
  it("fills the bar once the bytes are gone, so verifying does not read as a stall", () => {
    expect(uploadRowFraction(row({ fraction: 0.9, stage: "verifying" }))).toBe(1);
    expect(uploadRowFraction(row({ endedAt: 1, stage: "succeeded" }))).toBe(1);
  });

  it("shows movement when the size is unknown instead of sitting at empty", () => {
    expect(uploadRowFraction(row({ fraction: null }))).toBeGreaterThan(0);
  });

  it("freezes a failure where it stopped", () => {
    expect(uploadRowFraction(row({ fraction: 0.4, stage: "failed" }))).toBe(0.4);
  });
});

describe("pruneUploads", () => {
  it("never drops a row that is still running", () => {
    const rows = [row({ stage: "uploading" })];

    expect(pruneUploads(rows, 10_000_000)).toHaveLength(1);
  });

  it("keeps a failure on screen much longer than a success", () => {
    const succeeded = row({ endedAt: 0, id: "a", stage: "succeeded" });
    const failed = row({ endedAt: 0, id: "b", stage: "failed" });
    const rows = [succeeded, failed];

    const afterSuccessLinger = pruneUploads(rows, SUCCESS_LINGER_MS + 1);

    expect(afterSuccessLinger.map((item) => item.id)).toEqual(["b"]);
    expect(pruneUploads(rows, FAILURE_LINGER_MS + 1)).toHaveLength(0);
  });
});

describe("isUploadActive", () => {
  it("counts every pre-completion stage", () => {
    expect(isUploadActive("presigning")).toBe(true);
    expect(isUploadActive("uploading")).toBe(true);
    expect(isUploadActive("verifying")).toBe(true);
    expect(isUploadActive("succeeded")).toBe(false);
    expect(isUploadActive("failed")).toBe(false);
  });
});

describe("the store", () => {
  it("returns a stable reference until something changes", () => {
    startUpload("Payment proof");

    expect(getUploadRows()).toBe(getUploadRows());
  });

  it("notifies subscribers on every transition", () => {
    let notifications = 0;
    const unsubscribe = subscribeToUploads(() => {
      notifications += 1;
    });

    const id = startUpload("Payment proof");
    updateUpload(id, { fraction: 0.5, stage: "uploading" });
    finishUpload(id);
    unsubscribe();
    dismissUpload(id);

    // Three while subscribed; the dismiss lands after unsubscribing.
    expect(notifications).toBe(3);
  });

  it("ignores updates for a row that was already dismissed", () => {
    const id = startUpload("Payment proof");
    dismissUpload(id);

    updateUpload(id, { fraction: 1 });
    finishUpload(id);

    expect(getUploadRows()).toHaveLength(0);
  });

  it("records a failure with its reason", () => {
    const id = startUpload("Payment proof", 0);
    finishUpload(id, { error: "Storage refused it." }, 100);

    expect(getUploadRows()[0]).toMatchObject({
      endedAt: 100,
      error: "Storage refused it.",
      stage: "failed",
    });
  });

  it("keeps ids unique, so two photos picked in a row do not share a bar", () => {
    expect(startUpload("A")).not.toBe(startUpload("B"));
  });

  it("sweeps only what has expired, and no-ops when nothing has", () => {
    const id = startUpload("Payment proof", 0);
    finishUpload(id, {}, 0);

    const before = getUploadRows();
    sweepUploads(SUCCESS_LINGER_MS - 1);

    expect(getUploadRows()).toBe(before);

    sweepUploads(SUCCESS_LINGER_MS + 1);

    expect(getUploadRows()).toHaveLength(0);
  });
});
