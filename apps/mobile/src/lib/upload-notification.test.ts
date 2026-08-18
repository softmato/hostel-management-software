import { describe, expect, it } from "vitest";

import {
  EMPTY_TALLY,
  PERCENT_STEP,
  shouldRepost,
  tallyUploads,
  type UploadNotice,
  uploadNotice,
  type UploadTally,
} from "@/lib/upload-notification";
import type { UploadRow, UploadStage } from "@/lib/upload-queue";

/**
 * The two failures worth pinning:
 *
 * 1. **Double counting.** A finished row lingers in the queue for seconds, so a
 *    second upload started in that window must not inherit the first one's
 *    result and report "2 uploaded" for one file.
 * 2. **Repost storms.** `onProgress` fires per chunk. If the notice text changes
 *    on every one of those, the shade is rewritten dozens of times a second.
 */

function row(
  id: string,
  stage: UploadStage,
  extra: { error?: string; fraction?: number | null; label?: string } = {},
): UploadRow {
  return {
    endedAt: stage === "failed" || stage === "succeeded" ? 1_000 : null,
    error: extra.error ?? null,
    fraction: extra.fraction ?? null,
    id,
    label: extra.label ?? "Payment proof",
    stage,
    startedAt: 0,
  };
}

/** Feeds a sequence of queue states through the reducer, as the notifier does. */
function run(states: UploadRow[][]): UploadTally {
  return states.reduce<UploadTally>(
    (tally, rows) => tallyUploads(tally, rows),
    EMPTY_TALLY,
  );
}

describe("tallyUploads", () => {
  it("reports nothing for an empty queue", () => {
    expect(tallyUploads(EMPTY_TALLY, [])).toEqual(EMPTY_TALLY);
  });

  it("counts one in-flight upload and keeps its label", () => {
    const tally = tallyUploads(EMPTY_TALLY, [
      row("a", "uploading", { fraction: 0.42, label: "Payment proof" }),
    ]);

    expect(tally.active).toBe(1);
    expect(tally.total).toBe(1);
    expect(tally.label).toBe("Payment proof");
  });

  it("floors the percentage to the step so reposts stay bounded", () => {
    const tally = tallyUploads(EMPTY_TALLY, [row("a", "uploading", { fraction: 0.42 })]);

    expect(tally.percent).toBe(40);
    expect(tally.percent % PERCENT_STEP).toBe(0);
  });

  it("never claims 100% while bytes are still moving", () => {
    const tally = tallyUploads(EMPTY_TALLY, [row("a", "uploading", { fraction: 0.999 })]);

    expect(tally.percent).toBe(95);
  });

  it("averages across the files in flight", () => {
    const tally = tallyUploads(EMPTY_TALLY, [
      row("a", "uploading", { fraction: 1 }),
      row("b", "uploading", { fraction: 0 }),
    ]);

    expect(tally.percent).toBe(50);
    expect(tally.label).toBeNull();
  });

  it("counts a success once, however often the queue re-emits", () => {
    const done = [row("a", "succeeded")];
    const tally = run([[row("a", "uploading")], done, done, done]);

    expect(tally.succeeded).toBe(1);
    expect(tally.active).toBe(0);
  });

  it("starts a new batch rather than inheriting a lingering row", () => {
    // The classic bug: "Payment proof" is still on screen for 2.5s when the next
    // upload starts, and the new batch counts it again.
    const tally = run([
      [row("a", "uploading")],
      [row("a", "succeeded")],
      [row("a", "succeeded"), row("b", "uploading", { label: "Food photo" })],
    ]);

    expect(tally.succeeded).toBe(0);
    expect(tally.total).toBe(1);
    expect(tally.label).toBe("Food photo");
  });

  it("separates failures from successes in one batch", () => {
    const tally = run([
      [row("a", "uploading"), row("b", "uploading")],
      [row("a", "succeeded"), row("b", "failed", { error: "Network dropped" })],
    ]);

    expect(tally).toMatchObject({ active: 0, failed: 1, succeeded: 1, total: 2 });
  });

  it("keeps the tally after the queue prunes the rows away", () => {
    const tally = run([[row("a", "uploading")], [row("a", "succeeded")], []]);

    expect(tally.succeeded).toBe(1);
    expect(tally.label).toBe("Payment proof");
  });
});

describe("uploadNotice", () => {
  it("posts nothing when nothing has happened", () => {
    expect(uploadNotice(EMPTY_TALLY)).toBeNull();
  });

  it("names the single file it is uploading and stays ongoing", () => {
    const notice = uploadNotice(
      tallyUploads(EMPTY_TALLY, [
        row("a", "uploading", { fraction: 0.6, label: "Payment proof" }),
      ]),
    );

    expect(notice).toEqual({
      body: "60%",
      ongoing: true,
      title: "Uploading payment proof",
      tone: "active",
    });
  });

  it("counts files instead of naming one when the batch is bigger", () => {
    const notice = uploadNotice(
      tallyUploads(EMPTY_TALLY, [
        row("a", "uploading", { fraction: 0.5 }),
        row("b", "uploading", { fraction: 0.5 }),
      ]),
    );

    expect(notice?.title).toBe("Uploading 2 files");
    expect(notice?.body).toBe("0 of 2 done · 50%");
  });

  it("says preparing rather than 0% before the transfer has started", () => {
    const notice = uploadNotice(
      tallyUploads(EMPTY_TALLY, [row("a", "presigning", { fraction: null })]),
    );

    expect(notice?.body).toBe("Preparing…");
  });

  it("does not sit at 100% during the server-side check", () => {
    const notice = uploadNotice(
      tallyUploads(EMPTY_TALLY, [row("a", "verifying", { fraction: 1 })]),
    );

    expect(notice?.body).toBe("Checking the file…");
  });

  it("takes the least advanced stage when a batch is mid-flight", () => {
    // One file already being checked, one not yet signed: the batch is preparing.
    const tally = tallyUploads(EMPTY_TALLY, [
      row("a", "verifying", { fraction: 1 }),
      row("b", "presigning"),
    ]);

    expect(tally.phase).toBe("preparing");
  });

  it("reports the finished single upload by name, not ongoing", () => {
    const notice = uploadNotice(
      run([[row("a", "uploading", { label: "Payment proof" })], [row("a", "succeeded")]]),
    );

    expect(notice).toMatchObject({
      ongoing: false,
      title: "Payment proof uploaded",
      tone: "succeeded",
    });
  });

  it("leads with the failure when a batch is mixed", () => {
    const notice = uploadNotice(
      run([
        [row("a", "uploading"), row("b", "uploading")],
        [row("a", "succeeded"), row("b", "failed", { error: "Network dropped" })],
      ]),
    );

    expect(notice?.tone).toBe("failed");
    expect(notice?.title).toBe("1 of 2 uploads failed");
  });

  it("never leaves a finished notice sticky", () => {
    for (const stage of ["failed", "succeeded"] as const) {
      const notice = uploadNotice(run([[row("a", "uploading")], [row("a", stage)]]));

      expect(notice?.ongoing).toBe(false);
    }
  });
});

describe("shouldRepost", () => {
  const active: UploadNotice = {
    body: "40%",
    ongoing: true,
    title: "Uploading payment proof",
    tone: "active",
  };

  it("does not rewrite the shade for an identical notice", () => {
    expect(shouldRepost(active, { ...active })).toBe(false);
  });

  it("rewrites when the percentage step moves", () => {
    expect(shouldRepost(active, { ...active, body: "45%" })).toBe(true);
  });

  it("rewrites when a transfer finishes", () => {
    expect(
      shouldRepost(active, {
        body: "Finished uploading.",
        ongoing: false,
        title: "Payment proof uploaded",
        tone: "succeeded",
      }),
    ).toBe(true);
  });

  it("treats appearing and disappearing as changes", () => {
    expect(shouldRepost(null, active)).toBe(true);
    expect(shouldRepost(active, null)).toBe(true);
    expect(shouldRepost(null, null)).toBe(false);
  });

  it("stays quiet across a whole transfer's worth of chunk events", () => {
    // 200 progress events between 40% and 44.9% must produce one notice.
    let posts = 0;
    let last: UploadNotice | null = null;

    for (let index = 0; index < 200; index += 1) {
      const fraction = 0.4 + index * 0.000_24;
      const next = uploadNotice(
        tallyUploads(EMPTY_TALLY, [row("a", "uploading", { fraction })]),
      );

      if (shouldRepost(last, next)) {
        posts += 1;
        last = next;
      }
    }

    expect(posts).toBe(1);
  });
});
