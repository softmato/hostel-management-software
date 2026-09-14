/**
 * Reading a push the app has to draw itself.
 *
 * ## Why the app draws some pushes at all
 *
 * A push with a title reaches an Android phone as an FCM *notification
 * message*, and while the app is backgrounded or killed the Firebase SDK draws
 * it straight into the shade without ever calling `expo-notifications`. The
 * Firebase SDK has never heard of the categories the app registered, so a
 * question that should carry buttons arrives as plain text — which is exactly
 * how the night-status prompt first reached a real phone.
 *
 * So for a push that needs buttons, `push.service.ts` sends Android a
 * **data-only** message with the title and body inside `data.draw`, and the
 * background task hands it here, then draws it as a local notification with the
 * category attached. Local notifications are the path on which Android does
 * look the buttons up.
 *
 * The server only does this for a token that declared
 * {@link APP_DRAWS_CATEGORY_PUSHES}, because a build without this file would
 * take the data-only message and show nothing.
 *
 * No `expo-notifications` import, so Vitest can run it; the drawing lives in
 * `night-status-task.ts`.
 */

/**
 * Sent with the device token. Must equal `APP_DRAWS_CATEGORY_PUSHES` in
 * `apps/web/src/modules/notifications/push.service.ts` — a mismatch means the
 * server never trusts this build and the buttons never appear, with nothing
 * logged on either side.
 */
export const APP_DRAWS_CATEGORY_PUSHES = "draws-category-pushes";

export type DrawnPush = {
  body: string;
  categoryId: string;
  channelId?: string;
  /** The push's own data, minus `draw`, for the tap routing to read. */
  data: Record<string, unknown>;
  title: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The push to draw, or `null` when this task payload is anything else.
 *
 * The task payload on Android is the serialized FCM message, whose `data` map
 * holds Expo's JSON-encoded data under `body`, which `RemoteMessageSerializer`
 * also copies to `dataString`. Either is accepted, as is an
 * already-parsed object, so a library that decodes it for us later does not
 * silently turn the buttons off again.
 *
 * `null` for a button response (it has an `actionIdentifier`), for a message
 * the OS already drew (it has a `notification`), and for any data-only message
 * without a complete `draw` block. Drawing half a notification is worse than
 * drawing none: a blank row in the shade reads as a bug in the app.
 */
export function readDrawnPush(payload: unknown): DrawnPush | null {
  const message = asRecord(payload);

  if (!message || "actionIdentifier" in message || asRecord(message.notification)) {
    return null;
  }

  const fcmData = asRecord(message.data);

  if (!fcmData) {
    return null;
  }

  let data: Record<string, unknown> | null = null;

  for (const candidate of [fcmData.dataString, fcmData.body]) {
    if (typeof candidate === "string") {
      try {
        data = asRecord(JSON.parse(candidate));
      } catch {
        data = null;
      }
    } else {
      data = asRecord(candidate);
    }

    if (data) {
      break;
    }
  }

  const draw = asRecord(data?.draw);

  if (
    !data ||
    !draw ||
    typeof draw.title !== "string" ||
    !draw.title ||
    typeof draw.body !== "string" ||
    typeof draw.categoryId !== "string" ||
    !draw.categoryId
  ) {
    return null;
  }

  const { draw: _draw, ...rest } = data;

  return {
    body: draw.body,
    categoryId: draw.categoryId,
    ...(typeof draw.channelId === "string" && draw.channelId
      ? { channelId: draw.channelId }
      : {}),
    data: rest,
    title: draw.title,
  };
}
