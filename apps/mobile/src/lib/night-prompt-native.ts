/**
 * The native Android handler for the nightly prompt, seen from JavaScript.
 *
 * `modules/hostelhub-night-prompt` draws the prompt and answers its buttons
 * with no JavaScript running — see `NightPrompt.kt` for why. JavaScript has
 * two jobs left: telling it where the API is, and taking over any answer it
 * could not send.
 *
 * `requireOptionalNativeModule`, like `native-downloads.ts`: a build without
 * the module (iOS, or an Android binary older than it) gets `null` and every
 * call here is a no-op, leaving the JavaScript path in
 * `night-status-notification.ts` in charge.
 */

import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import type { QueuedNightStatus } from "@/lib/night-status-queue";

type NativeNightPrompt = {
  configure(apiBaseUrl: string): void;
  takePendingAnswers(): string;
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeNightPrompt>("HostelHubNightPrompt")
    : null;

/** Whether this build draws the prompt natively, and so replaces it itself. */
export const HAS_NATIVE_NIGHT_PROMPT = native !== null;

export function configureNativeNightPrompt(apiBaseUrl: string) {
  try {
    native?.configure(apiBaseUrl);
  } catch {
    // The JavaScript path still answers; see the note above.
  }
}

/** Answers the native handler holds, removed from it. Empty without the module. */
export function takeNativePendingAnswers(): QueuedNightStatus[] {
  if (!native) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(native.takePendingAnswers());

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is QueuedNightStatus =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as QueuedNightStatus).status === "string" &&
            typeof (entry as QueuedNightStatus).answeredAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}
