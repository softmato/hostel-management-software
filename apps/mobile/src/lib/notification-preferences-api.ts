/**
 * `GET`/`PATCH /account/notification-preferences`.
 *
 * Split from `notification-preferences.ts` so the formatting and summary logic
 * there stays importable by the node-only test runner — `lib/api` pulls in
 * `react-native`, whose Flow source vitest cannot parse.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type {
  EmailPreference,
  NotificationPreference,
} from "@/lib/notification-preferences";

export async function getNotificationPreference() {
  const response = await api.get<ApiEnvelope<{ preference: NotificationPreference }>>(
    "/account/notification-preferences",
  );

  return unwrap(response).preference;
}

export async function updateNotificationPreference(
  patch: Partial<NotificationPreference>,
) {
  const response = await api.patch<ApiEnvelope<{ preference: NotificationPreference }>>(
    "/account/notification-preferences",
    patch,
  );

  return unwrap(response).preference;
}

export async function getEmailPreference() {
  const response = await api.get<ApiEnvelope<{ preference: EmailPreference }>>(
    "/account/email-preferences",
  );

  return unwrap(response).preference;
}

export async function updateEmailPreference(mutedTopics: string[]) {
  const response = await api.patch<ApiEnvelope<{ preference: EmailPreference }>>(
    "/account/email-preferences",
    { mutedTopics },
  );

  return unwrap(response).preference;
}
