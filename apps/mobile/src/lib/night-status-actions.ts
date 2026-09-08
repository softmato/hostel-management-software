/**
 * The three answers a resident can give **without opening the app**, and how to
 * read one back off a notification.
 *
 * Its own module, with no `expo-notifications` import, for the usual reason:
 * Vitest here is node-side with no React Native shim, so anything that value-
 * imports a native module cannot be tested. `night-status-notification.ts` is
 * the half that talks to the OS and it imports this one. Same split as
 * `lib/complaints.ts` and `lib/night-status.ts`.
 *
 * ## Why the buttons are the preset list
 *
 * The owner asked for a reason field with ready-made options and a custom one.
 * A notification cannot render a dropdown, a chip row or a radio list — not on
 * Android, not on iOS. What it can render is buttons, and **one** free-text
 * field behind a button. That is the entire vocabulary available in the shade.
 *
 * So the presets become the buttons. `At home` is the one-tap preset, because it
 * is what the overwhelming majority of "not in tonight" answers actually are,
 * and `Outside…` opens the inline text field for everything else. The full list
 * — at a friend's, travelling, working late, hospital — lives on the in-app
 * screen and the bell row, which are not bound by the shade's layout.
 *
 * Three is also the practical ceiling: Android draws at most three actions
 * inline, and a fourth would be invisible on the surface this feature exists to
 * be answered from.
 *
 * ## Why the identifiers are namespaced strings
 *
 * `NotificationResponse.actionIdentifier` is a flat string shared with every
 * other category the app might register, and with the OS's own
 * `expo.modules.notifications.actions.DEFAULT` for a plain tap on the body. A
 * bare `"inside"` would be one collision away from a different feature's button
 * silently marking someone present.
 */

/** Mirrors the server's `nightStatusReasonSchema`. */
export type NightStatusReasonCode =
  | "HOME"
  | "FRIENDS"
  | "TRAVELLING"
  | "WORKING_LATE"
  | "HOSPITAL"
  | "OTHER";

/** The subset a resident may report about themselves, as the API takes them. */
export type SelfReportedStatus = "INSIDE_HOSTEL" | "MARKED_SAFE" | "OUTSIDE_HOSTEL";

/** What one answer is, before it is a request. */
export type NightStatusAnswer = {
  /** What they typed, when the action carried a text field. */
  note?: string;
  reasonCode?: NightStatusReasonCode;
  status: SelfReportedStatus;
};

/**
 * The category identifier the push's `categoryId` must equal.
 *
 * Must match `NIGHT_STATUS_CATEGORY` in
 * `apps/web/src/modules/safety/night-status-prompt.service.ts`. A mismatch
 * throws nothing and logs nothing — the notification simply arrives with no
 * buttons under it, which looks exactly like the feature not being built. That
 * is why both constants name each other.
 */
export const NIGHT_STATUS_CATEGORY = "night-status";

export const NIGHT_STATUS_ACTIONS = {
  HOME: "night-status:home",
  INSIDE: "night-status:inside",
  OUTSIDE: "night-status:outside",
} as const;

export type NightStatusActionId =
  (typeof NIGHT_STATUS_ACTIONS)[keyof typeof NIGHT_STATUS_ACTIONS];

/**
 * The buttons, in the order they are drawn.
 *
 * `Inside` first: it is the answer most people are giving most nights, and on a
 * locked screen the first button is the one that gets pressed without reading.
 *
 * Kept as data rather than inlined into the registration call so the test can
 * assert the shape without a native module — in particular that exactly one
 * action carries a text field, and that none of them opens the app.
 */
export const NIGHT_STATUS_BUTTONS: readonly {
  /** Fills the answer in when there is no text field to type into. */
  answer: NightStatusAnswer;
  buttonTitle: string;
  identifier: NightStatusActionId;
  /** The inline text field. Exactly one button has one; see the note above. */
  textInput?: { placeholder: string; submitButtonTitle: string };
}[] = [
  {
    answer: { status: "INSIDE_HOSTEL" },
    buttonTitle: "Inside",
    identifier: NIGHT_STATUS_ACTIONS.INSIDE,
  },
  {
    answer: { reasonCode: "HOME", status: "OUTSIDE_HOSTEL" },
    buttonTitle: "At home",
    identifier: NIGHT_STATUS_ACTIONS.HOME,
  },
  {
    /*
     * The typed answer. `OTHER` rather than a guess at what they wrote — the
     * sentence is the reason, and the code exists so the warden's board can
     * group the ones that were tapped.
     */
    answer: { reasonCode: "OTHER", status: "OUTSIDE_HOSTEL" },
    buttonTitle: "Outside…",
    identifier: NIGHT_STATUS_ACTIONS.OUTSIDE,
    textInput: {
      placeholder: "Where are you tonight?",
      submitButtonTitle: "Send",
    },
  },
];

/**
 * The reasons the in-app screen and the bell row offer, which the shade cannot.
 *
 * `OTHER` is deliberately absent: on a screen with a real text field, "other"
 * is what typing something means, and offering it as a chip gives the resident a
 * button whose only effect is to leave the reason blank.
 */
export const NIGHT_STATUS_REASONS: readonly {
  code: Exclude<NightStatusReasonCode, "OTHER">;
  label: string;
}[] = [
  { code: "HOME", label: "At home" },
  { code: "FRIENDS", label: "At a friend's" },
  { code: "TRAVELLING", label: "Travelling" },
  { code: "WORKING_LATE", label: "Working late" },
  { code: "HOSPITAL", label: "Hospital" },
];

/** `"HOME"` → `"At home"`, for a row that has a code and needs a word. */
export function reasonLabel(code: NightStatusReasonCode | null | undefined) {
  if (!code) {
    return "";
  }

  return NIGHT_STATUS_REASONS.find((reason) => reason.code === code)?.label ?? "";
}

/**
 * The answer behind a tapped button, or `null` if this was not one of ours.
 *
 * `null` for every notification that is not this category, for a plain tap on
 * the notification body (which the OS reports with its own default identifier),
 * and for an identifier from a build that registered different buttons. Every
 * one of those has to fall through to the ordinary "open the screen" routing
 * rather than write a status nobody chose — a background handler that guesses is
 * a background handler that marks people present while they are out.
 *
 * ## An empty text field is still an answer
 *
 * Somebody who taps `Outside…` and sends nothing has told the hostel they are
 * out. The reason is optional everywhere else in this feature — `DESIGN.md` is
 * explicit that being out is neutral rather than a warning — so it is optional
 * here too, and the status is recorded without one. Refusing the answer for want
 * of an explanation is how you teach people to stop answering.
 */
export function parseNightStatusAction(
  actionIdentifier: string | null | undefined,
  userText?: string | null,
): NightStatusAnswer | null {
  const button = NIGHT_STATUS_BUTTONS.find(
    (candidate) => candidate.identifier === actionIdentifier,
  );

  if (!button) {
    return null;
  }

  if (!button.textInput) {
    return button.answer;
  }

  const note = userText?.trim() ?? "";

  return note
    ? { ...button.answer, note }
    : /*
       * No text, so no reason — not `OTHER` with an empty note, which would put
       * a meaningless "Other" chip on the warden's board next to a blank.
       */
      { status: button.answer.status };
}

/** Whether a notification's data says it came from the nightly prompt. */
export function isNightStatusPrompt(
  data: Record<string, unknown> | null | undefined,
): boolean {
  return typeof data?.category === "string" && data.category === "NIGHT_STATUS";
}
