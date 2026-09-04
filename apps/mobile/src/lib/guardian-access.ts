/**
 * The resident's end of the guardian link — its types, its vocabulary, and the
 * pure rules over both.
 *
 * The four network calls live in `guardian-access-api.ts`, deliberately:
 * anything importing `lib/api` drags in `react-native`, whose Flow source the
 * node-only test runner cannot parse — so everything worth testing is kept on
 * this side of that line. Same split as `notification-preferences.ts`.
 *
 * Shapes mirror `serializeGuardianLink` and `guardianPermissionsSchema` in
 * `apps/web/src/modules/guardian/{guardian-invite.service,guardian.validation}.ts`,
 * read from the service rather than guessed from the route names.
 *
 * ## Not `lib/guardian.ts`
 *
 * That file is the **guardian role's** client: what a signed-in parent sees of
 * their ward. This is the **resident's** side of the same relationship — who
 * they have linked, and what each of those people may look at. Same product,
 * opposite ends, different serializers; one module for both is how the two
 * drift the next time either changes.
 *
 * ## The rule these functions exist to hold
 *
 * **Nothing shared is a real answer, and it must read like one.** All six flags
 * `false` is the *default* on the server — `guardianPermissionsSchema` defaults
 * every one to `false`, and `loadPermissions` returns the same when the
 * permission document is missing entirely, because "defaulting open here would
 * hand a guardian the whole record". So it is both the commonest state and the
 * safest, and a screen that renders it as blank space leaves the resident
 * unsure whether it simply failed to load.
 */

/**
 * What a resident may share, and the words for it.
 *
 * **These are the server's own `PERMISSION_LABELS`, not the web page's.** The
 * two disagree: `resident-guardians-page.tsx` writes "Food menu" and "Complaint
 * status (titles only)", while the service writes "This week's food menu" and
 * "Complaint status (titles only, never the details)".
 *
 * The service's win, because the service's are the ones that go into the
 * **invitation email** — `enabledPermissionLabels` feeds `guardianInvitationEmail`.
 * A resident ticking a box and a guardian reading what they were granted should
 * be looking at the same sentence, and the longer wording is the more honest
 * one: "titles only" alone leaves a reader to imagine they will see the
 * complaint text, which PRD §10 is explicit they must not.
 *
 * Order is the web page's — money first, then the daily things, then the two
 * that touch safety and grievances — rather than the alphabetical key order the
 * service happens to store them in.
 */
export const GUARDIAN_PERMISSIONS = [
  { key: "canViewPayments", label: "Fee status (paid / unpaid / due)" },
  { key: "canViewReceipts", label: "Payment receipts" },
  { key: "canViewNotices", label: "Hostel notices" },
  { key: "canViewFood", label: "This week's food menu" },
  { key: "canViewSafety", label: "Night safety summary (day-level only)" },
  {
    key: "canViewComplaintStatus",
    label: "Complaint status (titles only, never the details)",
  },
] as const;

export type GuardianPermissionKey = (typeof GUARDIAN_PERMISSIONS)[number]["key"];

export type GuardianPermissions = Record<GuardianPermissionKey, boolean>;

/** All six off — the shape a new invite starts from. */
export const NO_GUARDIAN_PERMISSIONS: GuardianPermissions = {
  canViewComplaintStatus: false,
  canViewFood: false,
  canViewNotices: false,
  canViewPayments: false,
  canViewReceipts: false,
  canViewSafety: false,
};

/**
 * One linked guardian.
 *
 * `status` carries all four values the model has, but **the list only ever
 * returns `ACTIVE` and `USED`** — `listResidentGuardians` filters to those two,
 * so a revoked guardian disappears rather than appearing greyed out. The wider
 * type is kept because `inviteGuardian` and the model both use it, and narrowing
 * it here would be this client asserting something the server does not.
 *
 * `invitationPending` is `ACTIVE` **and** a token still outstanding — it means
 * "invited, has not clicked the link yet", never "revoked". The token itself is
 * never serialised.
 *
 * `expiresAt`, `guardianId` and `invitationExpiresAt` are on the payload and are
 * **not** on the web page's hand-written type, which is why that page cannot
 * tell a resident how long an unaccepted invitation has left. They are carried
 * here so this client can.
 */
export type GuardianLink = {
  accessId: string;
  email: string;
  /** The access itself — a year out, not the invitation window. */
  expiresAt: string;
  guardianId: string;
  /** Only meaningful while `invitationPending`. Seven days from the invite. */
  invitationExpiresAt?: string;
  invitationPending: boolean;
  name: string;
  permissions: GuardianPermissions;
  phone: string;
  relation: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "USED";
};

/** The labels that are switched on, in the order the invite form shows them. */
export function grantedLabels(permissions: GuardianPermissions): string[] {
  return GUARDIAN_PERMISSIONS.filter((field) => permissions[field.key]).map(
    (field) => field.label,
  );
}

export function grantedKeys(permissions: GuardianPermissions): GuardianPermissionKey[] {
  return GUARDIAN_PERMISSIONS.filter((field) => permissions[field.key]).map(
    (field) => field.key,
  );
}

/**
 * One line naming what this guardian can actually see.
 *
 * Not a count. "3 of 6" tells a resident nothing about whether their father can
 * see the rent — which is the only question anybody asks of this screen — so the
 * first grant is named and the rest are counted behind it.
 */
export function describeSharing(permissions: GuardianPermissions): string {
  const granted = grantedLabels(permissions);

  if (granted.length === 0) {
    return "Nothing shared yet";
  }

  if (granted.length === 1) {
    return granted[0];
  }

  return `${granted[0]} and ${granted.length - 1} more`;
}

/** Whole days from `now` to `iso`, rounded up. Negative once it has passed. */
function daysUntil(iso: string, now: Date): number | null {
  const target = new Date(iso).getTime();

  if (Number.isNaN(target)) {
    return null;
  }

  return Math.ceil((target - now.getTime()) / 86_400_000);
}

/**
 * What to say about an invitation that has not been accepted, or `null` when
 * there is nothing to say because the guardian is already in.
 *
 * `invitationExpiresAt` is seven days out and is **optional on the payload** —
 * an older access row may not carry one. A pending invitation with no expiry is
 * reported as pending rather than as expired: the server decides whether the
 * token still works, and guessing "expired" here would tell a resident to
 * re-send an invitation that is fine.
 */
export function describeInvitation(
  link: Pick<GuardianLink, "invitationExpiresAt" | "invitationPending">,
  now: Date = new Date(),
): string | null {
  if (!link.invitationPending) {
    return null;
  }

  if (!link.invitationExpiresAt) {
    return "Invitation sent — not accepted yet";
  }

  const days = daysUntil(link.invitationExpiresAt, now);

  if (days === null) {
    return "Invitation sent — not accepted yet";
  }

  if (days <= 0) {
    return "Invitation expired — invite them again";
  }

  if (days === 1) {
    return "Invitation expires tomorrow";
  }

  return `Invitation expires in ${days} days`;
}

/**
 * Whether the invite form may be submitted, and what to say when it may not.
 *
 * Mirrors `guardianInviteSchema` — email, both names 1–80, phone 6–32, relation
 * 2–40 — so the resident is told before the request rather than by a 400. The
 * server still validates; this is not a substitute for it, and where the two
 * ever disagree the server is right.
 *
 * Returns the **first** problem in field order rather than a list. A form this
 * short is fixed one field at a time, and six messages at once reads as a
 * rejection of the whole thing.
 */
export function invalidInviteReason(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  relation: string;
}): string | null {
  if (input.firstName.trim().length < 1) {
    return "Their first name is needed.";
  }

  if (input.lastName.trim().length < 1) {
    return "Their last name is needed.";
  }

  if (input.firstName.trim().length > 80 || input.lastName.trim().length > 80) {
    return "That name is too long.";
  }

  // Deliberately loose. The server runs `z.string().email()`; a client-side
  // regex stricter than the server rejects addresses that would have worked,
  // which is a worse failure than one round trip.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return "That email address does not look right.";
  }

  const phone = input.phone.trim();

  if (phone.length < 6 || phone.length > 32) {
    return "Check the phone number — it is how they are identified when they sign in.";
  }

  const relation = input.relation.trim();

  if (relation.length < 2 || relation.length > 40) {
    return "Say how they are related — Mother, Father, Uncle.";
  }

  return null;
}
