/**
 * Keyword-based provider-role suggestion for the Maintenance screen.
 *
 * The admin types the problem in plain language ("tap in room 204 is leaking")
 * and we suggest which kind of service provider to call, which category the
 * request belongs in, how urgent it sounds and what to title it. Deliberately a
 * dumb scorer — no network, no model — so it can run on every keystroke, which
 * on a phone matters more than it does on the web: it is the difference between
 * typing one sentence and filling in four fields.
 *
 * ## A copy of `apps/web/src/lib/maintenance-role-suggest.ts`, on purpose
 *
 * The two files are the same rules and should stay that way — a repair the web
 * calls plumbing and the app calls carpentry is worse than either answer alone.
 * It is duplicated rather than shared because `packages/` carries no runtime
 * code either app imports, and standing one up for 300 lines of keyword tables
 * is not the trade. **If you edit the keyword lists here, edit them there too.**
 */

export type ProviderRole =
  | "PLUMBER"
  | "ELECTRICIAN"
  | "DOCTOR_CLINIC"
  | "INTERNET_TECHNICIAN"
  | "CLEANER"
  | "CARPENTER"
  | "PAINTER"
  | "WATER_SUPPLIER"
  | "APPLIANCE_REPAIR"
  | "ROOM_REPAIR"
  | "OTHER";

export type MaintenanceCategory =
  | "PLUMBING"
  | "ELECTRICAL"
  | "INTERNET"
  | "CLEANING"
  | "CARPENTRY"
  | "PAINTING"
  | "WATER"
  | "APPLIANCE"
  | "ROOM_REPAIR"
  | "HEALTH"
  | "OTHER";

export type RoleSuggestion = {
  /** Maintenance category that pairs with this role. */
  category: MaintenanceCategory;
  /** Keywords from the problem text that triggered the match. */
  matched: string[];
  role: ProviderRole;
  score: number;
};

type RoleRule = {
  category: MaintenanceCategory;
  /** Strong terms — one hit is usually enough to decide the role. */
  keywords: string[];
  role: ProviderRole;
  /** Weaker terms that only nudge the ranking. */
  weakKeywords?: string[];
};

const ROLE_LABELS: Record<ProviderRole, string> = {
  APPLIANCE_REPAIR: "Appliance Repair",
  CARPENTER: "Carpenter",
  CLEANER: "Cleaner",
  DOCTOR_CLINIC: "Doctor / Clinic",
  ELECTRICIAN: "Electrician",
  INTERNET_TECHNICIAN: "Internet Technician",
  OTHER: "Other",
  PAINTER: "Painter",
  PLUMBER: "Plumber",
  ROOM_REPAIR: "Room Repair",
  WATER_SUPPLIER: "Water Supplier",
};

export const PROVIDER_ROLES = Object.keys(ROLE_LABELS) as ProviderRole[];

export function providerRoleLabel(role: string) {
  return ROLE_LABELS[role as ProviderRole] ?? role.replaceAll("_", " ");
}

const ROLE_RULES: RoleRule[] = [
  {
    category: "PLUMBING",
    keywords: [
      "plumb",
      "tap",
      "faucet",
      "pipe",
      "leak",
      "leaking",
      "drip",
      "drain",
      "clog",
      "clogged",
      "blocked",
      "toilet",
      "commode",
      "flush",
      "sink",
      "basin",
      "shower",
      "geyser",
      "sewer",
      "septic",
      "overflow",
    ],
    role: "PLUMBER",
    weakKeywords: ["bathroom", "washroom", "water"],
  },
  {
    category: "ELECTRICAL",
    keywords: [
      "electric",
      "electrical",
      "electrician",
      "wiring",
      "wire",
      "socket",
      "plug point",
      "switch",
      "fuse",
      "mcb",
      "breaker",
      "short circuit",
      "shock",
      "bulb",
      "tube light",
      "tubelight",
      "light not",
      "power cut",
      "no power",
      "voltage",
      "inverter",
      "spark",
    ],
    role: "ELECTRICIAN",
    weakKeywords: ["light", "power", "fan", "current"],
  },
  {
    category: "INTERNET",
    keywords: [
      "internet",
      "wifi",
      "wi-fi",
      "router",
      "modem",
      "broadband",
      "fiber",
      "fibre",
      "network down",
      "no network",
      "lan",
      "ethernet",
      "isp",
      "worldlink",
      "ntc",
      "slow net",
    ],
    role: "INTERNET_TECHNICIAN",
    weakKeywords: ["connection", "signal", "speed"],
  },
  {
    category: "CLEANING",
    keywords: [
      "clean",
      "cleaning",
      "cleaner",
      "dirty",
      "garbage",
      "trash",
      "waste",
      "dust",
      "sweep",
      "mop",
      "stink",
      "smell",
      "pest",
      "cockroach",
      "insect",
      "mosquito",
      "rat",
      "bedbug",
      "fumigat",
    ],
    role: "CLEANER",
    weakKeywords: ["hygiene", "corridor"],
  },
  {
    category: "CARPENTRY",
    keywords: [
      "carpenter",
      "carpentry",
      "wood",
      "wooden",
      "door",
      "hinge",
      "lock broken",
      "latch",
      "cupboard",
      "wardrobe",
      "almirah",
      "shelf",
      "drawer",
      "table",
      "chair",
      "bed frame",
      "bunk",
      "window frame",
    ],
    role: "CARPENTER",
    weakKeywords: ["furniture", "lock", "bed"],
  },
  {
    category: "PAINTING",
    keywords: [
      "paint",
      "painting",
      "painter",
      "repaint",
      "whitewash",
      "white wash",
      "putty",
      "distemper",
      "peeling",
      "wall color",
      "wall colour",
    ],
    role: "PAINTER",
    weakKeywords: ["wall"],
  },
  {
    category: "WATER",
    keywords: [
      "water tanker",
      "tanker",
      "water supply",
      "no water",
      "water shortage",
      "water tank",
      "drinking water",
      "jar",
      "refill",
      "borewell",
      "well dry",
    ],
    role: "WATER_SUPPLIER",
    weakKeywords: ["supply"],
  },
  {
    category: "APPLIANCE",
    keywords: [
      "appliance",
      "fridge",
      "refrigerator",
      "washing machine",
      "microwave",
      "oven",
      "ac ",
      "air conditioner",
      "cooler",
      "heater",
      "tv",
      "television",
      "water purifier",
      "ro ",
      "dispenser",
      "not cooling",
    ],
    role: "APPLIANCE_REPAIR",
    weakKeywords: ["machine", "motor"],
  },
  {
    category: "ROOM_REPAIR",
    keywords: [
      "wall crack",
      "crack",
      "ceiling",
      "plaster",
      "tile",
      "tiles",
      "floor",
      "seepage",
      "damp",
      "roof",
      "window glass",
      "glass broken",
      "broken window",
    ],
    role: "ROOM_REPAIR",
    weakKeywords: ["repair", "room"],
  },
  {
    category: "HEALTH",
    keywords: [
      "doctor",
      "clinic",
      "medical",
      "medicine",
      "sick",
      "fever",
      "injury",
      "injured",
      "wound",
      "ambulance",
      "hospital",
      "first aid",
      "unwell",
      "vomit",
      "allerg",
    ],
    role: "DOCTOR_CLINIC",
    weakKeywords: ["health", "emergency"],
  },
];

const URGENT_KEYWORDS = [
  "urgent",
  "emergency",
  "immediately",
  "asap",
  "shock",
  "spark",
  "fire",
  "short circuit",
  "flood",
  "ambulance",
  "gas leak",
];

const HIGH_KEYWORDS = [
  "no water",
  "no power",
  "power cut",
  "not working",
  "broken",
  "blocked",
  "overflow",
  "leaking",
  "sick",
  "injury",
];

const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;

function normalize(text: string) {
  return ` ${text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .replaceAll(/\s+/g, " ")} `;
}

function countHits(haystack: string, keywords: string[]) {
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * Ranks provider roles against the problem text. Returns the strongest matches
 * first; an empty array means nothing recognisable was typed yet.
 */
export function suggestProviderRoles(problem: string, limit = 3): RoleSuggestion[] {
  const haystack = normalize(problem);

  if (haystack.trim().length < 3) {
    return [];
  }

  return ROLE_RULES.map((rule) => {
    const strong = countHits(haystack, rule.keywords);
    const weak = countHits(haystack, rule.weakKeywords ?? []);

    return {
      category: rule.category,
      matched: [...strong, ...weak].map((keyword) => keyword.trim()),
      role: rule.role,
      score: strong.length * STRONG_WEIGHT + weak.length * WEAK_WEIGHT,
    };
  })
    .filter((suggestion) => suggestion.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/** Top suggestion only, or `undefined` when the text matches nothing. */
export function suggestProviderRole(problem: string) {
  return suggestProviderRoles(problem, 1)[0];
}

/** Maintenance category that goes with a provider role. */
export function categoryForRole(role: string): MaintenanceCategory {
  return (
    ROLE_RULES.find((rule) => rule.role === role)?.category ??
    (role === "ROOM_REPAIR" ? "ROOM_REPAIR" : "OTHER")
  );
}

/** Priority hint derived from urgency words in the problem text. */
export function suggestPriority(problem: string) {
  const haystack = normalize(problem);

  if (countHits(haystack, URGENT_KEYWORDS).length > 0) {
    return "URGENT" as const;
  }

  if (countHits(haystack, HIGH_KEYWORDS).length > 0) {
    return "HIGH" as const;
  }

  return "MEDIUM" as const;
}

/** First line of the problem text, trimmed to fit the request title field. */
export function titleFromProblem(problem: string) {
  const firstLine = problem.trim().split("\n")[0]?.trim() ?? "";
  const title = firstLine || problem.trim();

  return title.length > 180 ? `${title.slice(0, 177)}...` : title;
}
