/**
 * Every read the warden portal makes, named once.
 *
 * ## Why a registry and not a loader per screen
 *
 * A prefetch has to run the *same* request the screen will run, keyed the *same*
 * way, or it warms a key nobody reads and the screen loads twice. Leaving the
 * composite loaders inside the screens made that impossible without the library
 * importing the screens, so they moved here and the screens import them back.
 * One definition, one key, one topic list per question.
 *
 * That is also what makes the keys trustworthy. `admin:money` is not a string
 * typed in two files that have to agree; it is `adminQuery.money(period).key`,
 * and a period that does not reach the key is a bug the type system catches at
 * the call site rather than a screen quietly showing January's invoices in
 * February.
 *
 * ## Three tiers of warming, on purpose
 *
 * Ordered by how sure the app is that somebody is about to look at the answer,
 * because that ordering *is* the design — everything warmed too eagerly is
 * bandwidth taken from the screen actually on the glass.
 *
 * 1. **{@link prefetchAdminPortal}**, the moment the portal opens: what the
 *    owner is certain to reach. The tab screens that read the hostel (Residents,
 *    Payments, More) and the four screens Home's own rows and tiles lead to
 *    (Today, roll call, inquiries, notices). Seven reads, deduplicated against
 *    whatever Home is already loading.
 * 2. **{@link prefetchAdminManage}**, three seconds later: the Manage grid's
 *    doors, warmed in the gap between Home appearing and a door being chosen.
 *    Second wave rather than one long list so these never queue in front of the
 *    five somebody is about to read.
 * 3. **{@link prefetchAdminRoute}** and {@link prefetchAdminResident}, on
 *    touch-down of the thing being opened. This is the catch-all — the routes
 *    the waves deliberately skip, and every per-id record, where warming ahead
 *    of the tap would mean warming forty of them.
 *
 * ## Every loader here is refusal-tolerant, and that is not incidental
 *
 * A warden's grants are per-flag — `viewPayments`, `viewNightStatus`,
 * `manageFood`, `manageNotices`, `manageMaintenance` — so a prefetch will be
 * refused on some of these for most wardens. Each loader keeps the shape the
 * screen renders and puts `null` where the permission was, exactly as it did
 * when it lived in the screen. A 403 is a section that says so, never an error
 * state and never a cached failure.
 */

import type { AxiosError } from "axios";

import { REALTIME_TOPIC } from "@/constants/topics";
import {
  type AdminAlerts,
  type AdminHostel,
  type AdminInvoiceMatrix,
  type AdminMaintenance,
  type AdminNightStatus,
  type AdminNotice,
  type AdminPeriodSummary,
  type AdminReport,
  type AdminResident,
  type AdminLedger,
  type AdminModeration,
  type AdminModerationFilter,
  getAdminAlerts,
  getAdminCommunityModeration,
  getAdminFoodRoutine,
  getAdminHostel,
  getAdminInvoices,
  getAdminLedger,
  getAdminMaintenance,
  getAdminNightStatus,
  getAdminPeriodSummary,
  getAdminReport,
  listAdminNotices,
  listAdminResidents,
} from "@/lib/admin-api";
import {
  type AttendanceAnalytics,
  type AttendanceSettings,
  type CommunitySettings,
  type CookPortalSettings,
  type FeeSchedule,
  type FeeScheduleData,
  type FoodAnalytics,
  type GatewayConfig,
  getAttendanceAnalytics,
  getAttendanceSettings,
  getCommunitySettings,
  getCookPortal,
  getFoodAnalytics,
  getMaintenanceSettings,
  getManagedHostel,
  getMoveInChecklist,
  getMoveOutChecklist,
  getPaymentProfile,
  getReportsOverview,
  getResident,
  getResidentLedger,
  listFeeSchedules,
  listGateways,
  listManagedInquiries,
  listManagedMaintenance,
  listManagedNotices,
  listManagedProviders,
  listReferrals,
  listResidentContacts,
  listStatementImports,
  listWardens,
  type MaintenanceCharge,
  type ManagedHostel,
  type ManagedInquiry,
  type ManagedMaintenance,
  type ManagedNotice,
  type ManagedProvider,
  type ManagedResident,
  type ManagedWarden,
  type MoveInChecklist,
  type MoveOutChecklist,
  type PaymentProfile,
  type ReferralsPayload,
  type ReportsOverview,
  type ResidentEmergencyContact,
  type ResidentGuardian,
  type ResidentLedger,
  type StatementImport,
} from "@/lib/admin-manage-api";
import { nepalPeriodKey } from "@/lib/format";
import { defineQuery, prefetchQuery, type Query } from "@/lib/query-cache";
/*
 * Imported for the `AdminTodayData` shape only. It lives in `resident-api`
 * because the resident's week and the admin's routine are the same object seen
 * from two sides.
 */
import type { FoodRoutine } from "@/lib/resident-api";

/**
 * A warden-portal question. The shape, the identity guarantee and the reasoning
 * behind both live in `lib/query-cache.ts`, where they are testable.
 */
export type AdminQuery<T> = Query<T>;

const define = defineQuery;

/* -------------------------------------------------------------------------- */
/* Home                                                                        */
/* -------------------------------------------------------------------------- */

export type AdminOverview = {
  hostel: AdminHostel | null;
  /** Null when the caller's role has no `viewPayments` grant. */
  periods: AdminPeriodSummary | null;
  report: AdminReport;
};

async function loadOverview(): Promise<AdminOverview> {
  const [report, hostel, periods] = await Promise.all([
    getAdminReport(),
    // A warden may be scoped to several hostels, in which case the profile read
    // needs a hostelId it has no way to choose. The numbers above still apply
    // across all of them, so the header simply loses its name.
    getAdminHostel().catch(() => null),
    /*
     * Tolerant for a different reason: `viewPayments` is a per-warden grant, so
     * this is the one read here that a legitimate user can be refused. Falling
     * back rather than failing keeps the rest of the screen — see
     * `earningsSummary`, which decides what the hero says without it.
     */
    getAdminPeriodSummary().catch(() => null),
  ]);

  return { hostel, periods, report };
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export type AdminMoneyData = {
  hostel: AdminHostel | null;
  invoices: AdminInvoiceMatrix;
  /** Null when the caller's role has no `viewPayments` grant — see below. */
  periods: AdminPeriodSummary | null;
};

async function loadMoney(period: string): Promise<AdminMoneyData> {
  const [invoices, hostel, periods] = await Promise.all([
    getAdminInvoices(period),
    // A warden scoped to several hostels cannot resolve one profile, and the
    // portal link is the only thing that needs it. The figures are unaffected.
    getAdminHostel().catch(() => null),
    /*
     * The monthly roll-up behind the month strip — one chip per month, each
     * carrying its own count of invoices still waiting. Tolerant because
     * `viewPayments` is a per-warden grant and this is the one read here a
     * legitimate user can be refused; the strip is absent in that case rather
     * than drawn as a single empty month.
     */
    getAdminPeriodSummary().catch(() => null),
  ]);

  return { hostel, invoices, periods };
}

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

export type AdminTodayData = {
  maintenance: AdminMaintenance | null;
  night: AdminNightStatus | null;
  notices: AdminNotice[];
  routine: FoodRoutine | null;
};

/**
 * Each source is allowed to fail on its own.
 *
 * A warden's capabilities are per-flag — `viewNightStatus`, `manageFood`,
 * `manageNotices`, `manageMaintenance` are four separate grants — so one 403
 * must not blank the other three sections. Null means "not yours or not
 * reachable", and each section says so in its own words rather than rendering
 * as empty, which is the lie this codebase keeps having to un-tell.
 */
async function loadToday(): Promise<AdminTodayData> {
  const [night, routine, notices, maintenance] = await Promise.all([
    getAdminNightStatus().catch(() => null),
    getAdminFoodRoutine().catch(() => null),
    listAdminNotices().catch(() => [] as AdminNotice[]),
    getAdminMaintenance().catch(() => null),
  ]);

  return { maintenance, night, notices, routine };
}

/* -------------------------------------------------------------------------- */
/* Roll call                                                                   */
/* -------------------------------------------------------------------------- */

export type AdminRollCallData = {
  /** Null when this account has no `viewNightStatus` grant — a 403, not a fault. */
  night: AdminNightStatus | null;
};

/**
 * Ten pages of a hundred.
 *
 * Not a paging strategy — a fuse. The roster is bounded by how many people live
 * in one hostel, so `totalPages` above this means the server is telling us
 * something we do not understand, and a thousand rows is already far past the
 * point where a phone list is the right answer. Better a truncated screen than
 * a launch that fires forty requests.
 */
export const MAX_ROLL_CALL_PAGES = 10;

async function loadRollCall(): Promise<AdminRollCallData> {
  try {
    const first = await getAdminNightStatus();

    if (!first.pagination.hasMore) {
      return { night: first };
    }

    const rest = await Promise.all(
      Array.from(
        { length: Math.min(first.pagination.totalPages, MAX_ROLL_CALL_PAGES) - 1 },
        (_unused, index) => getAdminNightStatus({ page: index + 2 }),
      ),
    );

    return {
      night: {
        ...first,
        statuses: [...first.statuses, ...rest.flatMap((page) => page.statuses)],
      },
    };
  } catch (error) {
    /*
     * Only a 403 becomes "not yours". Everything else — a timeout, a 500, no
     * network — has to stay an error, because rendering the permission card for
     * a server that is merely down tells a warden their access was removed.
     */
    if ((error as AxiosError).response?.status === 403) {
      return { night: null };
    }

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* One resident                                                                */
/* -------------------------------------------------------------------------- */

export type AdminResidentRecord = {
  contacts: {
    emergencyContacts: ResidentEmergencyContact[];
    guardians: ResidentGuardian[];
  };
  /**
   * Their whole payment history — null when this account cannot see money.
   * `viewPayments` is a separate capability, so a warden who may manage people
   * but not payments still gets the rest of the record.
   */
  ledger: ResidentLedger | null;
  moveIn: MoveInChecklist | null;
  moveOut: MoveOutChecklist | null;
  resident: ManagedResident;
  roomTypes: string[];
};

async function loadResident(id: string): Promise<AdminResidentRecord> {
  const [resident, contacts, moveIn, moveOut, hostel, ledger] = await Promise.all([
    getResident(id),
    listResidentContacts(id).catch(() => ({ emergencyContacts: [], guardians: [] })),
    getMoveInChecklist(id).catch(() => null),
    getMoveOutChecklist(id).catch(() => null),
    // Only for the room-type picker. A stale list would offer a type that no
    // longer exists, and the move would fail on the server rather than here.
    getManagedHostel().catch(() => null),
    getResidentLedger(id).catch(() => null),
  ]);

  return {
    contacts,
    ledger,
    moveIn,
    moveOut,
    resident,
    roomTypes: (hostel?.roomConfigurations ?? []).map((config) => config.roomType),
  };
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export type AdminFoodData = {
  cook: CookPortalSettings | null;
  routine: FoodRoutine | null;
};

async function loadFood(): Promise<AdminFoodData> {
  // Independently, and tolerantly. Both routes want `manageFood`, so in practice
  // they fail together — but a cook-portal outage blanking the menu editor would
  // be a bad trade for one shared `Promise.all`.
  const [routine, cook] = await Promise.all([
    getAdminFoodRoutine().catch(() => null),
    getCookPortal().catch(() => null),
  ]);

  return { cook, routine };
}

export type AdminMaintenanceData = {
  /** The owner's agreed call-out floors. Empty until somebody sets them. */
  charges: MaintenanceCharge[];
  maintenance: ManagedMaintenance | null;
  providers: ManagedProvider[];
};

async function loadMaintenance(status: string): Promise<AdminMaintenanceData> {
  const [maintenance, providers, charges] = await Promise.all([
    listManagedMaintenance(status ? { status } : {}).catch(() => null),
    listManagedProviders().catch(() => [] as ManagedProvider[]),
    /*
     * Tolerant, and empty rather than absent on failure. The charges are a
     * convenience on the confirm step; a hostel that has set none is the normal
     * first state, so "could not read them" and "there are none" already look
     * the same to every reader and there is nothing to distinguish.
     */
    getMaintenanceSettings().catch(() => [] as MaintenanceCharge[]),
  ]);

  return { charges, maintenance, providers };
}

export type AdminSettingsData = {
  attendance: AttendanceSettings | null;
  community: CommunitySettings | null;
  hostel: ManagedHostel;
};

async function loadSettings(): Promise<AdminSettingsData> {
  const [hostel, community, attendance] = await Promise.all([
    getManagedHostel(),
    getCommunitySettings().catch(() => null),
    getAttendanceSettings().catch(() => null),
  ]);

  return { attendance, community, hostel };
}

export type AdminReportsData = {
  attendance: AttendanceAnalytics | null;
  food: FoodAnalytics | null;
  overview: ReportsOverview | null;
};

async function loadReports(month: string): Promise<AdminReportsData> {
  const [overview, attendance, food] = await Promise.all([
    getReportsOverview(month).catch(() => null),
    getAttendanceAnalytics(30).catch(() => null),
    // `reports/food` wants `manageFood`, while the other two only want staff —
    // so this is the one a warden most often cannot see, and it fails alone.
    getFoodAnalytics(30).catch(() => null),
  ]);

  return { attendance, food, overview };
}

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminFinanceData = {
  gateways: GatewayConfig[] | null;
  profile: PaymentProfile | null;
  schedules: FeeSchedule[] | null;
};

async function loadFinance(): Promise<AdminFinanceData> {
  const [schedules, profile, gateways] = await Promise.all([
    listFeeSchedules()
      .then((data) => data.schedules)
      .catch(() => null),
    getPaymentProfile().catch(() => null),
    // The one read that needs `managePaymentProfile` rather than `viewPayments`
    // — it lists merchant codes and which keys are installed.
    listGateways().catch(() => null),
  ]);

  return { gateways, profile, schedules };
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every warden-portal question, by name.
 *
 * Parameterised ones are functions, and their argument is in the key. Anything
 * that changes the answer must change the key — that is the whole contract
 * between a screen and a prefetch.
 */
export const adminQuery = {
  /**
   * The group's shared queue — claims, complaints, inquiries, SOS.
   *
   * Not in {@link prefetchAdminPortal} on purpose: `AdminAlertsProvider` mounts
   * with the layout that runs the warm-up, so it is already asking. What the key
   * buys is the *return* trip — an owner who steps out to the public browse tabs
   * and comes back gets the badges painted rather than counted again.
   */
  alerts: (): AdminQuery<AdminAlerts> =>
    define(
      "admin:alerts",
      [
        REALTIME_TOPIC.PAYMENTS,
        REALTIME_TOPIC.COMPLAINTS,
        REALTIME_TOPIC.INQUIRIES,
        REALTIME_TOPIC.SAFETY,
      ],
      () => getAdminAlerts(),
    ),

  hostel: (): AdminQuery<AdminHostel | null> =>
    define("admin:hostel", [REALTIME_TOPIC.HOSTELS], () =>
      getAdminHostel().catch(() => null),
    ),

  inquiries: (): AdminQuery<ManagedInquiry[]> =>
    define("admin:inquiries", [REALTIME_TOPIC.INQUIRIES], () =>
      listManagedInquiries(),
    ),

  /**
   * The hostel again, and not a duplicate of `hostel` above.
   *
   * `getAdminHostel` is the dashboard's read — `/hostel-admin/hostel`, the
   * listing as the portal shows it. `getManagedHostel` is `/hostel-admin/profile`
   * and carries the room types and photos the Rooms screen edits. Two endpoints,
   * two shapes, two keys; collapsing them would hand Rooms an object with no
   * `roomTypes` on it.
   */
  managedHostel: (): AdminQuery<ManagedHostel> =>
    define(
      "admin:managed-hostel",
      [REALTIME_TOPIC.HOSTELS, REALTIME_TOPIC.ROOMS],
      () => getManagedHostel(),
    ),

  money: (period: string): AdminQuery<AdminMoneyData> =>
    define(
      `admin:money:${period}`,
      [REALTIME_TOPIC.PAYMENTS, REALTIME_TOPIC.RESIDENTS],
      () => loadMoney(period),
    ),

  /** `category` is the screen's own filter; `""` is its default, "all of them". */
  notices: (category: string): AdminQuery<ManagedNotice[]> =>
    define(`admin:notices:${category}`, [REALTIME_TOPIC.NOTICES], () =>
      listManagedNotices({ category }),
    ),

  overview: (): AdminQuery<AdminOverview> =>
    define(
      "admin:overview",
      [
        REALTIME_TOPIC.PAYMENTS,
        REALTIME_TOPIC.RESIDENTS,
        REALTIME_TOPIC.COMPLAINTS,
        REALTIME_TOPIC.SAFETY,
      ],
      loadOverview,
    ),

  feeSchedules: (): AdminQuery<FeeScheduleData> =>
    define("admin:fee-schedules", [REALTIME_TOPIC.PAYMENTS], () =>
      listFeeSchedules(),
    ),

  finance: (): AdminQuery<AdminFinanceData> =>
    define("admin:finance", [REALTIME_TOPIC.PAYMENTS], loadFinance),

  food: (): AdminQuery<AdminFoodData> =>
    define("admin:food", [REALTIME_TOPIC.FOOD], loadFood),

  ledger: (): AdminQuery<AdminLedger> =>
    define("admin:ledger", [REALTIME_TOPIC.PAYMENTS], () => getAdminLedger()),

  /** `status` is the screen's filter; `""` is its default, every request. */
  maintenance: (status: string): AdminQuery<AdminMaintenanceData> =>
    define(`admin:maintenance:${status}`, [REALTIME_TOPIC.MAINTENANCE], () =>
      loadMaintenance(status),
    ),

  moderation: (filter: AdminModerationFilter): AdminQuery<AdminModeration> =>
    define(`admin:moderation:${filter}`, [REALTIME_TOPIC.COMMUNITY], () =>
      getAdminCommunityModeration(filter),
    ),

  paymentProfile: (): AdminQuery<PaymentProfile> =>
    define("admin:payment-profile", [REALTIME_TOPIC.PAYMENTS], () =>
      getPaymentProfile(),
    ),

  referrals: (filter: string): AdminQuery<ReferralsPayload> =>
    define(`admin:referrals:${filter}`, [], () => listReferrals(filter)),

  /**
   * The month is in the key, and the month is the only thing the screen varies.
   * `""` is its default — whatever the server calls the current one.
   */
  reports: (month: string): AdminQuery<AdminReportsData> =>
    define(`admin:reports:${month}`, [], () => loadReports(month)),

  /**
   * One resident's whole record: profile, contacts, both checklists, the ledger
   * and the room-type list behind the move picker.
   *
   * Six requests, which is why this one is worth warming on touch-down of a
   * roster row — it is the slowest screen in the portal to open and the one an
   * owner opens most often.
   */
  resident: (id: string): AdminQuery<AdminResidentRecord> =>
    define(
      `admin:resident:${id}`,
      [REALTIME_TOPIC.RESIDENTS, REALTIME_TOPIC.PAYMENTS],
      () => loadResident(id),
    ),

  residents: (): AdminQuery<AdminResident[]> =>
    define("admin:residents", [REALTIME_TOPIC.RESIDENTS], () =>
      listAdminResidents(),
    ),

  rollCall: (): AdminQuery<AdminRollCallData> =>
    define(
      "admin:roll-call",
      [REALTIME_TOPIC.ATTENDANCE, REALTIME_TOPIC.SAFETY],
      loadRollCall,
    ),

  settings: (): AdminQuery<AdminSettingsData> =>
    define("admin:settings", [REALTIME_TOPIC.HOSTELS], loadSettings),

  statementImports: (): AdminQuery<StatementImport[]> =>
    define("admin:statement-imports", [REALTIME_TOPIC.PAYMENTS], () =>
      listStatementImports(),
    ),

  today: (): AdminQuery<AdminTodayData> =>
    define(
      "admin:today",
      [
        REALTIME_TOPIC.ATTENDANCE,
        REALTIME_TOPIC.FOOD,
        REALTIME_TOPIC.MAINTENANCE,
        REALTIME_TOPIC.NOTICES,
        REALTIME_TOPIC.SAFETY,
      ],
      loadToday,
    ),
  wardens: (): AdminQuery<ManagedWarden[]> =>
    define("admin:wardens", [], () => listWardens()),
} as const;

/** Warms one descriptor. Never throws, never re-asks something already fresh. */
export function prefetchAdminQuery<T>(query: AdminQuery<T>) {
  prefetchQuery(query.key, query.load, { topics: query.topics });
}

/**
 * What the portal warms the moment it opens.
 *
 * Three absences are deliberate:
 *
 * - **Home**, because it is mounting as this runs and already asking. Adding it
 *   would only hand the warm-up the request Home started — harmless, and
 *   misleading to read.
 * - **The alerts queue**, because `AdminAlertsProvider` fetches it once for the
 *   whole group. That is this same idea one layer up, and it predates this
 *   module.
 * - **Community**, because the tab is the platform-wide board every signed-in
 *   role sees, not a read of this hostel. It belongs to `CommunityBoard`, and
 *   warming it here would make one shared feed the warden portal's business.
 */
export function prefetchAdminPortal() {
  prefetchAdminQuery(adminQuery.residents());
  prefetchAdminQuery(adminQuery.money(nepalPeriodKey()));
  prefetchAdminQuery(adminQuery.today());
  prefetchAdminQuery(adminQuery.hostel());
  prefetchAdminQuery(adminQuery.rollCall());
  prefetchAdminQuery(adminQuery.inquiries());
  prefetchAdminQuery(adminQuery.notices(""));
}

/**
 * The Manage grid's doors, warmed once the first wave has had the network.
 *
 * Home's grid and the More tab list the same eight destinations, and touch-down
 * only buys the couple of hundred milliseconds between a finger landing and a
 * screen being pushed. That is enough to hide a single list read and not enough
 * to hide `manage/settings`, which is three. Warming them a few seconds in — by
 * which point the reader is still on Home deciding where to go — is what makes
 * those screens open already drawn rather than merely already loading.
 *
 * Second wave rather than one long list because order is the whole point: the
 * five reads above are the ones somebody is about to *look at*, and they must
 * not queue behind six they might not open. `prefetchQuery` deduplicates, so
 * anything touch-down already started costs nothing here.
 *
 * **Reports is deliberately not here.** `manage/reports` runs attendance and
 * food analytics over a month on the server; speculatively starting real work
 * is a different trade from speculatively reading a list. It is cached like
 * everything else, so opening it twice is one run — it is simply never started
 * by a guess.
 */
export function prefetchAdminManage() {
  prefetchAdminQuery(adminQuery.finance());
  prefetchAdminQuery(adminQuery.managedHostel());
  prefetchAdminQuery(adminQuery.food());
  prefetchAdminQuery(adminQuery.maintenance(""));
  prefetchAdminQuery(adminQuery.settings());
  prefetchAdminQuery(adminQuery.ledger());
}

/**
 * The href a button is about to push → the question that screen will ask.
 *
 * Every destination in the portal whose first paint is a network read is here,
 * because the whole point is that no screen reached from a tile or a row makes
 * the reader watch it load. Two kinds of route are absent, and both should stay
 * absent:
 *
 * - **Nothing to warm.** `manage/scan` opens a camera and
 *   `manage/resident/new` opens an empty form.
 * - **Warming would be the work.** `manage/reports` runs analytics over a month
 *   of attendance and food on the server. Touch-down is the right trigger for a
 *   read; it is the wrong trigger for a report run that the tap may not follow.
 *   Reports is still *cached* — opening it twice is one run — it is simply not
 *   speculatively started.
 *
 * Unknown hrefs are a no-op rather than a throw. This is called from press
 * handlers on grids and lists whose contents change, and a tile added without an
 * entry here must cost a hundred milliseconds, not a crash.
 */
export function prefetchAdminRoute(href: string) {
  switch (href) {
    case "/(admin)/alerts":
      prefetchAdminQuery(adminQuery.alerts());
      return;
    case "/(admin)/community-reports":
      prefetchAdminQuery(adminQuery.moderation("flagged"));
      return;
    case "/(admin)/money":
      prefetchAdminQuery(adminQuery.money(nepalPeriodKey()));
      return;
    case "/(admin)/residents":
      prefetchAdminQuery(adminQuery.residents());
      return;
    case "/(admin)/today":
      prefetchAdminQuery(adminQuery.today());
      return;
    case "/manage/finance":
      prefetchAdminQuery(adminQuery.finance());
      return;
    /*
     * The rate card, not the finance summary: `finance/rates` and
     * `finance/history` are two views of one list and share the key, so warming
     * either warms both.
     */
    case "/manage/finance/history":
    case "/manage/finance/rates":
      prefetchAdminQuery(adminQuery.feeSchedules());
      return;
    case "/manage/finance/payment-setup":
      prefetchAdminQuery(adminQuery.paymentProfile());
      return;
    case "/manage/finance/statement":
      prefetchAdminQuery(adminQuery.ledger());
      prefetchAdminQuery(adminQuery.hostel());
      return;
    case "/manage/food":
      prefetchAdminQuery(adminQuery.food());
      return;
    case "/manage/inquiries":
      prefetchAdminQuery(adminQuery.inquiries());
      return;
    case "/manage/maintenance":
      prefetchAdminQuery(adminQuery.maintenance(""));
      return;
    case "/manage/notices":
      prefetchAdminQuery(adminQuery.notices(""));
      return;
    case "/manage/referrals":
      prefetchAdminQuery(adminQuery.referrals(""));
      return;
    case "/manage/roll-call":
      prefetchAdminQuery(adminQuery.rollCall());
      return;
    case "/manage/rooms":
      prefetchAdminQuery(adminQuery.managedHostel());
      return;
    case "/manage/settings":
      prefetchAdminQuery(adminQuery.settings());
      return;
    case "/manage/statements":
      prefetchAdminQuery(adminQuery.statementImports());
      return;
    case "/manage/wardens":
      prefetchAdminQuery(adminQuery.wardens());
      return;
    default:
  }
}

/**
 * One resident's record, warmed from wherever their name is on screen.
 *
 * Separate from {@link prefetchAdminRoute} because the id is the point: the
 * roster, the money list and the invoice sheet all lead to
 * `manage/resident/[id]`, and each of them knows *which* resident before the tap
 * lands. Six requests deep, it is the slowest open in the portal.
 *
 * Deliberately **not** applied to every visible row on mount. A forty-person
 * roster would be two hundred and forty requests to save one tap's wait, which
 * is not a trade any of this is trying to make.
 */
export function prefetchAdminResident(id: string) {
  if (!id) {
    return;
  }

  prefetchAdminQuery(adminQuery.resident(id));
}
