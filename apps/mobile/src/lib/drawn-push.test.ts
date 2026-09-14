import { describe, expect, it } from "vitest";

import { readDrawnPush } from "@/lib/drawn-push";

const pushData = {
  category: "NIGHT_STATUS",
  draw: {
    body: "Your hostel checks in at 20:00.",
    categoryId: "night-status",
    channelId: "default_v2",
    title: "Are you in the hostel tonight?",
  },
  night: "2026-09-14",
  path: "/night-status",
};

/** The FCM message as `RemoteMessageSerializer` hands it to the task. */
function fcmMessage(data: Record<string, unknown>) {
  const encoded = JSON.stringify(data);

  return {
    data: { body: encoded, dataString: encoded, experienceId: "@softmato/hostelhub" },
    messageId: "0:1",
    notification: null,
  };
}

describe("readDrawnPush", () => {
  it("reads the title, body and category out of a data-only message", () => {
    expect(readDrawnPush(fcmMessage(pushData))).toEqual({
      body: "Your hostel checks in at 20:00.",
      categoryId: "night-status",
      channelId: "default_v2",
      data: { category: "NIGHT_STATUS", night: "2026-09-14", path: "/night-status" },
      title: "Are you in the hostel tonight?",
    });
  });

  it("falls back to `body` when `dataString` is missing", () => {
    const message = fcmMessage(pushData);

    delete (message.data as Record<string, unknown>).dataString;

    expect(readDrawnPush(message)?.categoryId).toBe("night-status");
  });

  it("ignores a button response", () => {
    expect(
      readDrawnPush({ ...fcmMessage(pushData), actionIdentifier: "night-status:inside" }),
    ).toBeNull();
  });

  it("ignores a message the OS already drew", () => {
    expect(
      readDrawnPush({ ...fcmMessage(pushData), notification: { title: "x" } }),
    ).toBeNull();
  });

  it("ignores data-only messages with no complete draw block", () => {
    expect(readDrawnPush(fcmMessage({ category: "NIGHT_STATUS" }))).toBeNull();
    expect(
      readDrawnPush(fcmMessage({ draw: { ...pushData.draw, title: "" } })),
    ).toBeNull();
    expect(
      readDrawnPush(fcmMessage({ draw: { ...pushData.draw, categoryId: undefined } })),
    ).toBeNull();
    expect(readDrawnPush({ data: { body: "not json" }, notification: null })).toBeNull();
    expect(readDrawnPush(null)).toBeNull();
  });
});
