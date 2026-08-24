/**
 * Where a push notification takes you when it is tapped.
 *
 * Decided on the server so that adding a category ships its own destination,
 * and an older app build still lands somewhere sensible instead of on whatever
 * screen it happens to be showing. The mobile app treats `data.path` as opaque
 * and hands it to `router.push()`; paths therefore have to match the route
 * groups in `apps/mobile/src/app`.
 *
 * `actionUrl` wins when a notification carries one — that is already a
 * hand-picked destination for exactly this row, and it is what the web bell
 * links to, so the two surfaces agree.
 */

export type DeepLinkInput = {
  actionUrl?: string;
  category: string;
  data?: Record<string, unknown>;
};

/** Fallback per category. Anything unmapped goes to the notification list. */
const CATEGORY_PATHS: Record<string, string> = {
  ACCOUNT: "/(resident)/more/profile",
  ACCOUNT_DELETION: "/(resident)/more/settings",
  ANNOUNCEMENT: "/(resident)/notices",
  ATTENDANCE: "/(resident)/more/attendance",
  COMMUNITY: "/community",
  COMPLAINT: "/(resident)/more/complaints",
  ELECTRICIAN: "/(provider)",
  FOOD: "/(resident)/food",
  GENERAL: "/notifications",
  HOSTEL_APPROVAL: "/notifications",
  INQUIRY: "/(admin)",
  MAINTENANCE: "/(provider)",
  NOTICE: "/(resident)/notices",
  PAYMENT: "/(resident)/payments",
  PLUMBER: "/(provider)",
  REVIEW: "/(resident)/more/reviews",
  ROOM: "/(resident)/more/profile",
  SERVICE_PROVIDER: "/(provider)",
  SOS: "/(admin)/alerts",
  STORE_CART: "/(store)/cart",
  URGENT: "/notifications",
};

const FALLBACK_PATH = "/notifications";

function readId(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

export function deepLinkForNotification(input: DeepLinkInput): string {
  // A single leading slash only. `//evil.example` is protocol-relative — it
  // reads as a local path but resolves to another origin, so it must not reach
  // a router or a WebView.
  if (
    input.category !== "STORE_ORDER" &&
    input.actionUrl &&
    input.actionUrl.startsWith("/") &&
    !input.actionUrl.startsWith("//")
  ) {
    return input.actionUrl;
  }

  // A notification about one specific thing should open that thing, not its
  // list. The id is only trusted when the category says what it refers to —
  // `data` is written by many call sites and is not a stable schema.
  switch (input.category) {
    case "PAYMENT": {
      const invoiceId = readId(input.data, "invoiceId");
      return invoiceId ? `/(resident)/payments/${invoiceId}` : CATEGORY_PATHS.PAYMENT;
    }
    case "COMPLAINT": {
      const complaintId = readId(input.data, "complaintId");
      return complaintId
        ? `/(resident)/more/complaints/${complaintId}`
        : CATEGORY_PATHS.COMPLAINT;
    }
    case "NOTICE":
    case "ANNOUNCEMENT": {
      const noticeId = readId(input.data, "noticeId");
      return noticeId ? `/(resident)/notices/${noticeId}` : CATEGORY_PATHS.NOTICE;
    }
    case "COMMUNITY": {
      const postId = readId(input.data, "postId");
      return postId ? `/community/${postId}` : CATEGORY_PATHS.COMMUNITY;
    }
    case "STORE_ORDER": {
      const orderId = readId(input.data, "orderId");
      return orderId ? `/store/order/${orderId}` : "/(store)/orders";
    }
    default:
      return CATEGORY_PATHS[input.category] ?? FALLBACK_PATH;
  }
}
