/**
 * Single source of truth for portal navigation.
 *
 * The sidebar renders these groups directly, and the header command palette
 * searches entries derived from the same tree — so a tab can never exist in one
 * place and be missing from the other.
 */

export type PortalIconName =
  | "activity"
  | "bed"
  | "bell"
  | "building"
  | "calendar"
  | "card"
  | "chart"
  | "clipboard"
  | "dashboard"
  | "file"
  | "flag"
  | "food"
  | "gift"
  | "globe"
  | "help"
  | "layout"
  | "map"
  | "megaphone"
  | "message"
  | "moon"
  | "qr"
  | "receipt"
  | "scroll"
  | "settings"
  | "shield"
  | "siren"
  | "sparkles"
  | "star"
  | "tag"
  | "toggle"
  | "user"
  | "users"
  | "wrench";

export type PortalNavLeaf = {
  badge?: number;
  /** Shown in the command palette result row. */
  description?: string;
  href: string;
  icon?: PortalIconName;
  keywords?: string[];
  label: string;
};

export type PortalNavItem = PortalNavLeaf & {
  children?: PortalNavLeaf[];
};

export type PortalNavGroup = {
  items: PortalNavItem[];
  /** Small uppercase section heading; omit for an unlabelled first block. */
  label?: string;
};

export type PortalSearchEntry = {
  description: string;
  group: string;
  href: string;
  id: string;
  keywords: string[];
  label: string;
};

/* -------------------------------------------------------------------------- */
/* Platform owner                                                             */
/* -------------------------------------------------------------------------- */

export const PLATFORM_NAV: PortalNavGroup[] = [
  {
    items: [
      {
        description:
          "Platform-wide KPIs, approval queue, subscription revenue, and recent audit activity.",
        href: "/platform/dashboard",
        icon: "dashboard",
        keywords: ["home", "overview", "kpi", "metrics", "analytics"],
        label: "Dashboard",
      },
    ],
    label: "Overview",
  },
  {
    items: [
      {
        description:
          "Review submitted hostels — check KYC documents, then approve, reject, request more papers, publish, or unpublish.",
        href: "/platform/hostels",
        icon: "building",
        keywords: [
          "approval",
          "queue",
          "pending",
          "reject",
          "publish",
          "onboarding",
          "kyc",
          "verification",
          "documents",
          "licence",
          "identity",
          "verify",
          "compliance",
        ],
        label: "Hostel Approvals",
      },
      {
        description:
          "Manage live public listings — visibility, featured placement, and listing quality.",
        href: "/platform/listings",
        icon: "globe",
        keywords: ["public", "live", "featured", "visibility", "seo", "ranking"],
        label: "Listings",
      },
      {
        description:
          "Duplicate and ghost-listing reports raised by users or the automated duplicate check.",
        href: "/platform/abuse-flags",
        icon: "flag",
        keywords: ["abuse", "duplicate", "ghost", "spam", "report", "fraud"],
        label: "Abuse Flags",
      },
      {
        /*
         * Public-space posts belong to no hostel, so no hostel admin can reach
         * them. Without this queue they would go unreviewed entirely.
         */
        description:
          "Reported posts from every community space, including posts that belong to no hostel.",
        href: "/platform/community",
        icon: "message",
        keywords: ["community", "posts", "moderation", "reports", "flagged", "abuse"],
        label: "Community Reports",
      },
      {
        description:
          "Paid placements in the community sidebar — colleges, hostels and local businesses, ordered by priority.",
        href: "/platform/sponsors",
        icon: "megaphone",
        keywords: [
          "sponsors",
          "ads",
          "advertising",
          "placement",
          "colleges",
          "priority",
          "campaign",
        ],
        label: "Sponsors",
      },
    ],
    label: "Hostels",
  },
  {
    items: [
      {
        description:
          "Every account on the platform — owners, wardens, residents, and guardians — with room, guardian, fee, and activation detail.",
        href: "/platform/users",
        icon: "users",
        keywords: [
          "accounts",
          "owners",
          "wardens",
          "residents",
          "students",
          "tenants",
          "guardians",
          "roles",
          "activation",
          "directory",
        ],
        label: "Users",
      },
      {
        description:
          "Approve service provider applications and manage the verified provider network.",
        href: "/platform/service-providers",
        icon: "wrench",
        keywords: [
          "providers",
          "vendors",
          "maintenance",
          "electrician",
          "plumber",
          "verify",
        ],
        label: "Service Providers",
      },
    ],
    label: "People",
  },
  {
    items: [
      {
        children: [
          {
            description:
              "Roll-up of resident payments recorded across every hostel, with proof approvals.",
            href: "/platform/payments",
            keywords: ["collection", "due", "proof", "receipt", "esewa", "khalti"],
            label: "Payments",
          },
          {
            description:
              "Subscription tiers charged to hostels — price, billing cycle, limits, and features.",
            href: "/platform/fee-plans",
            keywords: ["plans", "subscription", "tier", "pricing", "billing", "quota"],
            label: "Fee Plans",
          },
          {
            description:
              "Immutable ledger of every platform transaction with method, reference, and status.",
            href: "/platform/transactions",
            keywords: ["ledger", "txn", "refund", "settlement", "invoice", "history"],
            label: "Transactions",
          },
        ],
        href: "/platform/payments",
        icon: "card",
        label: "Fees & Payments",
      },
    ],
    label: "Finance",
  },
  {
    items: [
      {
        description:
          "Moderate resident ratings and reviews; hide abusive or fake content.",
        href: "/platform/reviews",
        icon: "star",
        keywords: ["ratings", "moderation", "hide", "feedback", "stars"],
        label: "Reviews",
      },
      {
        description:
          "Escalated complaints across hostels that need platform-level oversight.",
        href: "/platform/complaints",
        icon: "message",
        keywords: ["complaint", "escalation", "grievance", "sla", "resolution"],
        label: "Complaints",
      },
    ],
    label: "Moderation",
  },
  {
    items: [
      {
        description:
          "Site identity, homepage hero copy, headline stats, and trust points shown to the public.",
        href: "/platform/config/site",
        icon: "layout",
        keywords: ["homepage", "hero", "brand", "tagline", "stats", "trust", "content"],
        label: "Site Content",
      },
      {
        description:
          "Cities and areas offered in public search filters and the hostel registration form.",
        href: "/platform/config/locations",
        icon: "map",
        keywords: ["cities", "areas", "kathmandu", "pokhara", "filters", "locations"],
        label: "Locations",
      },
      {
        description:
          "Facility and amenity catalogue used by listings, filters, and comparison.",
        href: "/platform/config/facilities",
        icon: "sparkles",
        keywords: ["amenities", "wifi", "facilities", "features", "filters", "catalogue"],
        label: "Facilities",
      },
      {
        description: "Public pricing page plans — price, features, and highlighted tier.",
        href: "/platform/config/pricing",
        icon: "tag",
        keywords: ["pricing", "plans", "packages", "public", "tiers"],
        label: "Pricing Plans",
      },
      {
        description: "Site-wide announcement banner shown above the public header.",
        href: "/platform/config/announcements",
        icon: "megaphone",
        keywords: ["banner", "announcement", "notice", "alert", "marketing"],
        label: "Announcements",
      },
      {
        description:
          "Terms of service and privacy policy content served on the public site.",
        href: "/platform/config/legal",
        icon: "scroll",
        keywords: ["terms", "privacy", "policy", "legal", "compliance"],
        label: "Legal Pages",
      },
      {
        description:
          "Toggle public surfaces — inquiries, comparison, service provider signup, registration.",
        href: "/platform/config/features",
        icon: "toggle",
        keywords: ["flags", "toggle", "enable", "disable", "kill switch", "rollout"],
        label: "Feature Flags",
      },
    ],
    label: "Website Config",
  },
  {
    items: [
      {
        description:
          "Operational reports across hostels, revenue, occupancy, and complaints.",
        href: "/platform/reports",
        icon: "chart",
        keywords: ["report", "export", "analytics", "csv", "insights"],
        label: "Reports",
      },
      {
        description:
          "Hostel owners asking to close their account. Nothing happens until you approve.",
        href: "/platform/account-deletions",
        icon: "clipboard",
        keywords: [
          "delete",
          "deletion",
          "account",
          "close account",
          "erase",
          "privacy",
          "gdpr",
        ],
        label: "Account Deletions",
      },
      {
        description: "Immutable trail of every privileged action taken on the platform.",
        href: "/platform/audit-logs",
        icon: "clipboard",
        keywords: ["audit", "trail", "history", "log", "who did what", "security"],
        label: "Audit Log",
      },
      {
        description: "Platform owner account, workspace snapshot, and access controls.",
        href: "/platform/settings",
        icon: "settings",
        keywords: ["settings", "account", "password", "profile", "preferences"],
        label: "Settings",
      },
    ],
    label: "System",
  },
];

/* -------------------------------------------------------------------------- */
/* Hostel admin / warden                                                      */
/* -------------------------------------------------------------------------- */

export const HOSTEL_ADMIN_NAV: PortalNavGroup[] = [
  {
    items: [
      {
        description:
          "Occupancy, collections, open complaints, and today's operational summary.",
        href: "/hostel-admin/dashboard",
        icon: "dashboard",
        keywords: ["home", "overview", "summary", "today"],
        label: "Dashboard",
      },
      {
        description:
          "Public hostel profile — photos, facilities, rules, pricing, and contact.",
        href: "/hostel-admin/profile",
        icon: "building",
        keywords: ["profile", "listing", "photos", "facilities", "rules"],
        label: "Hostel Profile",
      },
      {
        description: "Room and bed map with vacancy and repair status.",
        href: "/hostel-admin/rooms",
        icon: "bed",
        keywords: ["rooms", "beds", "vacancy", "map", "allocation"],
        label: "Rooms & Beds",
      },
    ],
  },
  {
    items: [
      {
        description: "Resident directory, activation codes, guardians, and fee status.",
        href: "/hostel-admin/residents",
        icon: "users",
        keywords: ["residents", "tenants", "students", "activation", "guardian"],
        label: "Residents",
      },
      {
        description: "Warden accounts, permissions, and activity for this hostel.",
        href: "/hostel-admin/wardens",
        icon: "shield",
        keywords: ["warden", "staff", "permissions", "team"],
        label: "Wardens",
      },
      {
        description: "Public inquiries from prospective residents with notes and status.",
        href: "/hostel-admin/inquiries",
        icon: "message",
        keywords: ["inquiry", "leads", "visit", "enquiry", "prospect"],
        label: "Inquiries",
      },
      {
        description:
          "Move-in and move-out checklists, provided items, and deposit refunds.",
        href: "/hostel-admin/move-in-out",
        icon: "clipboard",
        keywords: ["move in", "move out", "checklist", "deposit", "refund", "handover"],
        label: "Move-In / Move-Out",
      },
    ],
    label: "Residents",
  },
  {
    items: [
      {
        children: [
          {
            description: "Record payments, approve proofs, and track dues per resident.",
            href: "/hostel-admin/payments",
            keywords: ["payment", "collection", "proof", "receipt", "due"],
            label: "Payments",
          },
          {
            description:
              "The rate card every invoice is computed from, by bed type, with history.",
            href: "/hostel-admin/fee-schedule",
            keywords: [
              "fee",
              "rent",
              "rate card",
              "schedule",
              "deposit",
              "charges",
              "pricing",
            ],
            label: "Fee Schedule",
          },
          {
            description:
              "Upload your wallet or bank statement and settle the month against what arrived.",
            href: "/hostel-admin/reconcile",
            keywords: [
              "reconcile",
              "statement",
              "esewa",
              "khalti",
              "bank",
              "csv",
              "import",
              "unmatched",
            ],
            label: "Reconcile",
          },
          {
            description:
              "Your QR, wallet IDs and bank account — what residents see when they pay.",
            href: "/hostel-admin/payment-setup",
            keywords: ["qr", "esewa", "khalti", "bank", "account", "payment setup"],
            label: "Payment Setup",
          },
          {
            description:
              "Let residents pay in one tap through eSewa or Khalti — settles itself, no approval queue.",
            href: "/hostel-admin/payment-gateways",
            keywords: [
              "esewa",
              "khalti",
              "fonepay",
              "gateway",
              "online",
              "checkout",
              "merchant",
            ],
            label: "Online Checkout",
          },
          {
            description:
              "Full payment ledger with method, reference, and reconciliation status.",
            href: "/hostel-admin/transactions",
            keywords: ["ledger", "transaction", "history", "reconcile", "refund"],
            label: "Transactions",
          },
        ],
        href: "/hostel-admin/payments",
        icon: "card",
        label: "Fees & Payments",
      },
    ],
    label: "Finance",
  },
  {
    items: [
      {
        description: "Daily menu, meal photos, and resident food feedback.",
        href: "/hostel-admin/food",
        icon: "food",
        keywords: ["food", "menu", "meal", "kitchen", "feedback"],
        label: "Food & Menu",
      },
      {
        description: "Night safety roll-call, manual overrides, and absence follow-up.",
        href: "/hostel-admin/night-status",
        icon: "moon",
        keywords: ["attendance", "night", "roll call", "inside", "outside", "safety"],
        label: "Attendance / Night",
      },
      {
        description: "Publish notices to residents and track read status.",
        href: "/hostel-admin/notices",
        icon: "megaphone",
        keywords: ["notice", "announcement", "circular", "broadcast"],
        label: "Notices",
      },
      {
        description:
          "Resident complaints with updates, attachments, and resolution flow.",
        href: "/hostel-admin/complaints",
        icon: "message",
        keywords: ["complaint", "issue", "ticket", "resolve"],
        label: "Complaints",
      },
      {
        description:
          "Raise repair requests with an auto-suggested provider role, assign verified providers, and track history.",
        href: "/hostel-admin/maintenance",
        icon: "wrench",
        keywords: [
          "maintenance",
          "repair",
          "ticket",
          "electrical",
          "plumbing",
          "provider",
          "vendor",
          "electrician",
          "plumber",
          "book visit",
        ],
        label: "Maintenance & Providers",
      },
      {
        description: "Live SOS alerts raised by residents with escalation history.",
        href: "/hostel-admin/sos-alerts",
        icon: "siren",
        keywords: ["sos", "emergency", "alert", "panic", "safety"],
        label: "SOS Alerts",
      },
      {
        description:
          "Zone-based attendance for today, absence alerts, and manual overrides.",
        href: "/hostel-admin/attendance",
        icon: "clipboard",
        keywords: ["attendance", "location", "geofence", "absent", "present"],
        label: "Attendance",
      },
      {
        /*
         * Not a feed — the feed itself lives at `/community` and is reached
         * from the header. What stays in the portal is the queue of this
         * hostel's posts that people reported.
         */
        description: "Review reported posts from your hostel and post announcements.",
        href: "/hostel-admin/community",
        icon: "flag",
        keywords: ["community", "feed", "posts", "moderation", "reports", "flagged"],
        label: "Community Reports",
      },
    ],
    label: "Operations",
  },
  {
    items: [
      {
        description: "Referral codes, joined referrals, and reward payouts.",
        href: "/hostel-admin/referrals",
        icon: "gift",
        keywords: ["referral", "reward", "invite", "code"],
        label: "Referrals",
      },
      {
        description:
          "Compose targeted or scheduled notifications and track delivery and read counts.",
        href: "/hostel-admin/notifications",
        icon: "bell",
        keywords: ["notification", "alert", "broadcast", "push", "schedule", "announce"],
        label: "Notifications",
      },
      {
        description: "Occupancy, collection, complaint, and maintenance reports.",
        href: "/hostel-admin/reports",
        icon: "chart",
        keywords: ["report", "analytics", "export", "insights"],
        label: "Reports",
      },
      {
        description: "Hostel workspace controls for profile, resident access, and staff.",
        href: "/hostel-admin/settings",
        icon: "settings",
        keywords: ["settings", "preferences", "access", "workspace"],
        label: "Settings",
      },
    ],
    label: "Growth & System",
  },
];

/* -------------------------------------------------------------------------- */
/* Resident + guardian                                                        */
/* -------------------------------------------------------------------------- */

export const RESIDENT_NAV: PortalNavGroup[] = [
  {
    items: [
      { href: "/resident/dashboard", icon: "dashboard", label: "Dashboard" },
      { href: "/resident/profile", icon: "user", label: "My Profile" },
    ],
  },
  {
    items: [
      {
        href: "/resident/payments",
        icon: "card",
        keywords: ["due", "rent", "upload", "receipt", "esewa", "proof"],
        label: "Fees & Payments",
      },
      {
        // Its own entry rather than a tab inside Fees & Payments: a resident
        // opens that page to *do* something about a due date, and the
        // programme's own view is what they open when they want to see what
        // their codes and receipts add up to. Two errands, two destinations.
        href: "/resident/offer-program",
        icon: "sparkles",
        keywords: [
          "offer",
          "program",
          "reference",
          "code",
          "certified",
          "receipt",
          "membership",
        ],
        label: "Offer Program",
      },
      { href: "/resident/food", icon: "food", label: "Food Menu" },
      // No Community entry: it is one platform-wide room at `/community`,
      // linked from the portal header instead of each portal's sidebar.
      { href: "/resident/notices", icon: "megaphone", label: "Notices" },
    ],
    label: "Daily",
  },
  {
    items: [
      { href: "/resident/complaints", icon: "message", label: "Complaints" },
      { href: "/resident/night-status", icon: "moon", label: "Night Status" },
      {
        href: "/resident/attendance",
        icon: "clipboard",
        keywords: ["location", "tracking", "consent", "present", "absent"],
        label: "Attendance",
      },
      { href: "/resident/sos", icon: "siren", label: "SOS" },
      {
        href: "/resident/guardians",
        icon: "shield",
        keywords: ["parent", "family", "access", "permissions"],
        label: "Guardians",
      },
      { href: "/resident/reviews", icon: "star", label: "Reviews" },
    ],
    label: "Safety & Feedback",
  },
  {
    items: [
      { href: "/resident/referral", icon: "gift", label: "Referral" },
      { href: "/resident/notifications", icon: "bell", label: "Notifications" },
    ],
    label: "Account",
  },
];

export const GUARDIAN_NAV: PortalNavGroup[] = [
  {
    items: [
      { href: "/guardian/dashboard", icon: "receipt", label: "Fee Summary" },
      { href: "/guardian/notices", icon: "megaphone", label: "Notices" },
      { href: "/guardian/food", icon: "food", label: "Food View" },
    ],
  },
  {
    items: [
      { href: "/guardian/safety", icon: "shield", label: "Safety Summary" },
      { href: "/guardian/emergency-contact", icon: "siren", label: "Emergency Contact" },
    ],
    label: "Safety",
  },
  {
    items: [
      { href: "/guardian/notifications", icon: "bell", label: "Notifications" },
      { href: "/guardian/messages", icon: "message", label: "Messages" },
      { href: "/guardian/help", icon: "help", label: "Help & Support" },
    ],
    label: "Support",
  },
];

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

function toId(href: string) {
  return href.replace(/^\//, "").replaceAll("/", "-");
}

/**
 * Flattens the nav tree into palette entries. Parents that only exist to hold
 * children (no description of their own) are skipped so the palette lists the
 * real destinations rather than the accordion header.
 */
export function searchEntriesFromNav(groups: PortalNavGroup[]): PortalSearchEntry[] {
  const entries: PortalSearchEntry[] = [];
  const seen = new Set<string>();

  function push(leaf: PortalNavLeaf, group: string, parentLabel?: string) {
    if (seen.has(leaf.href)) return;
    seen.add(leaf.href);
    entries.push({
      description: leaf.description ?? `Open ${leaf.label}.`,
      group: parentLabel ? `${group} › ${parentLabel}` : group,
      href: leaf.href,
      id: toId(leaf.href),
      keywords: leaf.keywords ?? [],
      label: leaf.label,
    });
  }

  for (const group of groups) {
    const groupLabel = group.label ?? "General";

    for (const item of group.items) {
      if (item.children && item.children.length > 0) {
        for (const child of item.children) {
          push(child, groupLabel, item.label);
        }
        continue;
      }

      push(item, groupLabel);
    }
  }

  return entries;
}

export const PLATFORM_SEARCH_ENTRIES = searchEntriesFromNav(PLATFORM_NAV);

/**
 * Destinations a PLATFORM_MODERATOR ("acting superadmin") may not open, kept in
 * step with the superadmin-only rules in `route-access.ts`. Hiding them is a
 * courtesy — the route rule and the API guard are what actually enforce it.
 */
const SUPERADMIN_ONLY_PREFIXES = [
  "/platform/account-deletions",
  "/platform/config",
  "/platform/fee-plans",
  "/platform/settings",
];

function isSuperadminOnlyHref(href: string) {
  return SUPERADMIN_ONLY_PREFIXES.some(
    (prefix) => href === prefix || href.startsWith(`${prefix}/`),
  );
}

/** Drops superadmin-only entries, then any group or parent left with nothing. */
function withoutSuperadminOnly(groups: PortalNavGroup[]): PortalNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => !isSuperadminOnlyHref(child.href)),
        }))
        .filter((item) => {
          if (item.children) {
            return item.children.length > 0;
          }

          return !isSuperadminOnlyHref(item.href);
        }),
    }))
    .filter((group) => group.items.length > 0);
}

export const PLATFORM_MODERATOR_NAV = withoutSuperadminOnly(PLATFORM_NAV);
export const PLATFORM_MODERATOR_SEARCH_ENTRIES =
  searchEntriesFromNav(PLATFORM_MODERATOR_NAV);
export const HOSTEL_ADMIN_SEARCH_ENTRIES = searchEntriesFromNav(HOSTEL_ADMIN_NAV);
export const RESIDENT_SEARCH_ENTRIES = searchEntriesFromNav(RESIDENT_NAV);
export const GUARDIAN_SEARCH_ENTRIES = searchEntriesFromNav(GUARDIAN_NAV);

/* -------------------------------------------------------------------------- */
/* Tenant-scoped hostel admin URLs                                            */
/* -------------------------------------------------------------------------- */

export const LEGACY_HOSTEL_ADMIN_PREFIX = "/hostel-admin";

/** `/hostel-admin/payments` → `/green-view-hostel/admin/payments`. */
export function hostelAdminHref(slug: string, href: string) {
  if (!href.startsWith(LEGACY_HOSTEL_ADMIN_PREFIX)) {
    return href;
  }

  return `/${slug}/admin${href.slice(LEGACY_HOSTEL_ADMIN_PREFIX.length)}`;
}

/** The same nav tree, pointed at one hostel's workspace. */
export function hostelAdminNavForSlug(slug: string): PortalNavGroup[] {
  return HOSTEL_ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      children: item.children?.map((child) => ({
        ...child,
        href: hostelAdminHref(slug, child.href),
      })),
      href: hostelAdminHref(slug, item.href),
    })),
  }));
}
