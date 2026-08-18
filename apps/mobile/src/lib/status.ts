/**
 * Which colour a server status enum earns.
 *
 * Lives in `lib/` rather than next to `<StatusPill>` because Vitest here runs
 * in a node environment with no React Native shim — anything importing
 * `react-native` cannot be tested, and this table is exactly the part worth
 * testing.
 *
 * It is an **explicit map**, not substring matching. The web's `StatusBadge`
 * tests `children.includes("PAID")`, which is quietly wrong in both
 * directions: `UNPAID` contains `PAID`, so an unpaid invoice renders green,
 * and `PENDING_PROOF` only lands on amber by luck of clause ordering. A table
 * also fails safely — an enum nobody has mapped comes out neutral rather than
 * confidently green.
 */

export const BADGE_TONES = ["danger", "info", "neutral", "success", "warning"] as const;

export type BadgeTone = (typeof BADGE_TONES)[number];

/**
 * `PENDING_PROOF` is warning, not success: the resident has claimed the
 * payment but the hostel has not agreed yet, and green there is how someone
 * concludes they are paid up and stops chasing it.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: "success",
  APPROVED: "success",
  CANCELLED: "neutral",
  CLEARED: "success",
  CLOSED: "neutral",
  ESCALATED: "danger",
  EXPIRED: "neutral",
  FAILED: "danger",
  IN_PROGRESS: "info",
  INITIATED: "info",
  /** `Referral.status`: the friend has been in touch, nothing has happened yet. */
  INQUIRY_CREATED: "info",
  JOINED: "success",
  MOVED_OUT: "neutral",
  OPEN: "warning",
  OVERDUE: "danger",
  PAID: "success",
  PARTIAL: "warning",
  PENDING: "warning",
  PENDING_PROOF: "warning",
  REJECTED: "danger",
  RESOLVED: "success",
  REWARDED: "success",
  REVERSED: "danger",
  SETTLED: "success",
  SUBMITTED: "info",
  SUSPENDED: "danger",
  UNDER_REVIEW: "info",
  UNPAID: "danger",
  VERIFIED: "success",
  WAIVED: "neutral",
};

export function statusTone(status: string | null | undefined): BadgeTone {
  return STATUS_TONES[status?.trim().toUpperCase() ?? ""] ?? "neutral";
}
