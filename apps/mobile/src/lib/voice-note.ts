/**
 * The rules and the words around a maintenance voice note.
 *
 * Pure — no `expo-audio`, no React Native — so the arithmetic and the copy are
 * testable under the repo's node-side Vitest. That is also why the recording
 * *settings* are not here: `RecordingOptions` needs `AudioQuality` and
 * `IOSOutputFormat`, which are runtime enums, and importing them pulls the whole
 * native module into a test that has no shim for it. They live beside the
 * recorder in `components/voice-note-recorder.tsx`, which is React Native
 * already.
 */

/**
 * How long a note may run before recording stops on its own.
 *
 * Three minutes. Not a storage limit — the platform accepts 10 MB, which is
 * twenty minutes of this — but a *listening* one: a contractor opening a job
 * will play the first thirty seconds of a five-minute recording and then ring
 * the hostel to ask what the problem is, which is what the recording existed to
 * avoid. It also stops a phone left in a pocket from uploading the afternoon.
 */
export const VOICE_NOTE_MAX_MS = 3 * 60 * 1000;

/** `1:07`. Minutes and seconds, because nothing here runs to an hour. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Whether a recording is long enough to be worth attaching.
 *
 * A tap that starts and stops the recorder produces a fraction of a second of
 * silence, and a request carrying one is worse than a request carrying none: the
 * provider sees a play button, presses it, hears nothing, and learns not to
 * trust the next one.
 */
export const VOICE_NOTE_MIN_MS = 1000;

export function isUsableRecording(milliseconds: number): boolean {
  return milliseconds >= VOICE_NOTE_MIN_MS;
}

/**
 * Who is going to listen to this, which is the only thing that differs between
 * the two places a note is recorded.
 *
 * A warden's maintenance note is heard by a contractor who has not seen the
 * fault; a resident's complaint note is heard by their own hostel's staff. The
 * mechanics — the cap, the countdown, the play-it-back nudge — are identical,
 * so the recorder is one component and only the sentence changes.
 */
export type VoiceNoteContext = "complaint" | "maintenance";

const IDLE_HINTS: Record<VoiceNoteContext, string> = {
  complaint: "Optional. Your hostel hears exactly what you say, in your own words.",
  maintenance: "Optional. The person coming to fix it hears exactly what you describe.",
};

const READY_HINTS: Record<VoiceNoteContext, string> = {
  complaint: "Play it back before you send it. You can record over it or delete it.",
  maintenance:
    "Play it back before you raise the job. You can record over it or delete it.",
};

const RECORDING_HINTS: Record<VoiceNoteContext, string> = {
  complaint: "Say where it is and what is wrong.",
  maintenance: "Say where it is and what it is doing.",
};

/** The line under the recorder, which changes with what is in hand. */
export function recorderHint(state: {
  context?: VoiceNoteContext;
  durationMs: number;
  hasRecording: boolean;
  recording: boolean;
}): string {
  const context = state.context ?? "maintenance";

  if (state.recording) {
    return `Recording — ${formatDuration(
      Math.max(0, VOICE_NOTE_MAX_MS - state.durationMs),
    )} left. ${RECORDING_HINTS[context]}`;
  }

  if (state.hasRecording) {
    return READY_HINTS[context];
  }

  return IDLE_HINTS[context];
}
