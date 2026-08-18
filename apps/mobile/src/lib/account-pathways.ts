/**
 * What "delete my account" means, per pathway.
 *
 * A leaf module with no imports, for two reasons: `lib/account-api.ts` reaches
 * React Native through the axios client and so cannot be loaded by the node-side
 * Vitest here, and this copy is the part worth testing — it is the last thing
 * somebody reads before an irreversible action.
 *
 * **The strings are `apps/web/src/app/_components/account-deletion-panel.tsx`'s
 * `PATHWAY_COPY`, verbatim.** Not paraphrased: the web's own comment explains why
 * they exist ("the copy has to tell the truth *before* the click, because 'delete my
 * account' means four different things here"), and two clients wording the same
 * consequence differently is how one of them ends up wording it wrongly. The 60-day
 * figure in `SELF_SERVICE` is the one thing to check against `graceperiodDays` if
 * the server's grace period ever changes.
 */

export type DeletionPathway =
  | "BLOCKED"
  | "GUARDIAN_RELEASE"
  | "PLATFORM_REVIEW"
  | "SELF_SERVICE";

export type PathwayCopy = {
  /** The button. Empty on `BLOCKED`, which has no action. */
  action: string;
  body: string;
  confirmDescription: string;
  confirmTitle: string;
  heading: string;
};

export const PATHWAY_COPY: Record<DeletionPathway, PathwayCopy> = {
  BLOCKED: {
    action: "",
    body: "",
    confirmDescription: "",
    confirmTitle: "",
    heading: "Your account cannot be deleted right now",
  },
  GUARDIAN_RELEASE: {
    action: "Remove my guardian access",
    body: "You are here as a guardian. Removing your access stops you seeing your resident's information and turns this into an ordinary account — it does not erase you from this platform. Once it is an ordinary account you can delete it outright from this same page.",
    confirmDescription:
      "You will immediately stop seeing your resident's attendance, payments and complaints. Getting it back needs a fresh invitation from them. Your account itself stays.",
    confirmTitle: "Remove your guardian access?",
    heading: "Remove your guardian access",
  },
  PLATFORM_REVIEW: {
    action: "Send my request to the platform owner",
    body: "Your hostel's residents, payments and staff all hang off this account, so it cannot be deleted on the spot. Tell us why and we will pass the request to the platform owner. Nothing changes on your account, and you can keep working normally, until they act on it.",
    confirmDescription:
      "Your reason goes to the platform owner for review. Nothing changes on your account or your hostel in the meantime — you can keep working normally until they act on it.",
    confirmTitle: "Send this request to the platform owner?",
    heading: "Ask the platform owner to close your account",
  },
  SELF_SERVICE: {
    action: "Delete my account",
    body: "Your account closes immediately and everything is permanently erased after 60 days. During those 60 days you can undo it using the link we email you. Payment and audit records are kept with your name removed — hostels are required to keep their own accounts.",
    confirmDescription:
      "You will be signed out and will not be able to sign in again. Everything is permanently erased in 60 days — until then you can undo this using the link we email you.",
    confirmTitle: "Close your account?",
    heading: "Delete your account",
  },
};

/** `accountDeletionRequestSchema`: trimmed, 10–1000. */
export const MIN_DELETION_REASON = 10;
export const MAX_DELETION_REASON = 1000;

/**
 * Whether a reason is long enough to send.
 *
 * The 10-character floor is the server's, and it exists so a single character
 * cannot satisfy a field the platform owner has to read and act on. Checking it
 * here means the button is disabled rather than the request being refused after
 * somebody has already confirmed an irreversible-sounding dialog.
 */
export function deletionReasonError(raw: string, pathway: DeletionPathway): string | null {
  const reason = raw.trim();

  if (reason.length < MIN_DELETION_REASON) {
    /*
     * The server requires a reason on every pathway, including
     * `GUARDIAN_RELEASE` — where the web's label calls it "optional context for the
     * hostel". That label is wrong: `accountDeletionRequestSchema` has no branch,
     * so an empty reason is a 422 there too. The label here says required.
     */
    return pathway === "GUARDIAN_RELEASE"
      ? "Add a sentence or two for the hostel before continuing."
      : "Add a sentence or two before continuing.";
  }

  return reason.length > MAX_DELETION_REASON ? "That is too long." : null;
}

/** Whether there is any action to offer at all. */
export function canRequestDeletion(pathway: DeletionPathway): boolean {
  return pathway !== "BLOCKED";
}
