import { NEPAL_COLLEGES } from "@/lib/maps/nepal-colleges";

/**
 * Filters understood by `GET /api/v1/public/hostels` — see
 * publicHostelListQuerySchema. The hero search's whole job is to turn a
 * sentence into one of these.
 */
export type SearchFilters = {
  area?: string;
  facility?: string;
  food?: "veg" | "non-veg";
  maxPrice?: number;
  minPrice?: number;
  q?: string;
  roomType?: string;
  type?: "BOYS" | "GIRLS" | "CO_LIVING";
};

export type ParsedSearch = {
  /** How much of the query the deterministic pass explained, 0..1. */
  confidence: number;
  filters: SearchFilters;
  /**
   * True when `filters.q` is just the raw sentence used as a last-resort text
   * search rather than something the parser recognised. Callers merging this
   * with a better result must not let that placeholder win.
   */
  rawTextOnly: boolean;
  /** Which pass produced this — surfaced for debugging, not shown to users. */
  source: "keyword" | "llm" | "fallback";
};

/**
 * Known Kathmandu-valley localities. Matching an area by name is by far the
 * most common hero search, and it is exactly the case an LLM should never be
 * paid for.
 */
export const AREAS = [
  "Baneshwor",
  "New Baneshwor",
  "Old Baneshwor",
  "Koteshwor",
  "Balkumari",
  "Imadol",
  "Gwarko",
  "Satdobato",
  "Lagankhel",
  "Pulchowk",
  "Jawalakhel",
  "Kupondole",
  "Sanepa",
  "Ekantakuna",
  "Chabahil",
  "Boudha",
  "Baluwatar",
  "Maharajgunj",
  "Basundhara",
  "Samakhusi",
  "Gongabu",
  "Balaju",
  "Kalanki",
  "Kalimati",
  "Kirtipur",
  "Thamel",
  "Putalisadak",
  "Dillibazar",
  "Bagbazar",
  "Anamnagar",
  "Ghattekulo",
  "Sinamangal",
  "Tinkune",
  "Jadibuti",
  "Bhaktapur",
  "Suryabinayak",
  "Lokanthali",
  "Kausaltar",
  "Thimi",
  "Budhanilkantha",
  "Tokha",
  "Swayambhu",
  "Dhumbarahi",
  "Naxal",
  "Lazimpat",
  "Sundhara",
  "Teku",
  "Kalopul",
];

export const CITIES = [
  "Kathmandu",
  "Lalitpur",
  "Bhaktapur",
  "Pokhara",
  "Biratnagar",
  "Patan",
];

/** Facility words a seeker actually types, mapped to the stored facility text. */
const FACILITY_ALIASES: Array<[RegExp, string]> = [
  [/\bwi-?fi\b|\binternet\b/i, "WiFi"],
  [/\bhot water\b|\bgeyser\b/i, "Hot water"],
  [/\bparking\b|\bbike park\w*\b/i, "Parking"],
  [/\blaundry\b|\bwashing\b/i, "Laundry"],
  [/\bgym\b|\bfitness\b/i, "Gym"],
  [/\bstudy (?:table|room)\b|\breading room\b/i, "Study table"],
  [/\battach(?:ed)? (?:bath|toilet)\w*\b/i, "Attached bathroom"],
  [/\bac\b|\bair con\w*\b/i, "AC"],
  [/\bcctv\b|\bsecurity camera\b/i, "CCTV"],
  [/\bbackup\b|\binverter\b|\bgenerator\b/i, "Power backup"],
];

/** Values match the listing page's room-type dropdown, not free admin text. */
const ROOM_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/\bsingle\b|\b1\s*sharing\b|\bone sharing\b/i, "Single"],
  [/\b(?:two|2)\s*sharing\b|\bdouble\b/i, "Double"],
  [/\b(?:three|3)\s*sharing\b|\btriple\b/i, "Triple"],
  [/\b(?:four|4)\s*sharing\b|\bdorm\w*\b/i, "Dormitory"],
];

/** The only values downstream filters accept. Also bounds what the LLM may emit. */
export const ROOM_TYPES = ROOM_TYPE_ALIASES.map(([, value]) => value);
export const FACILITIES = FACILITY_ALIASES.map(([, value]) => value);

/**
 * Carries no location/name signal on its own. Stripped before an unexplained
 * sentence becomes a `q` substring search, so "hostel near Ghattekulo" can
 * still match a hostel whose area is exactly "Ghattekulo" instead of requiring
 * that whole sentence to appear literally in the data.
 */
const SEARCH_FILLER_WORDS = new Set([
  "a", "an", "the", "any", "some", "good", "best", "nice",
  "hostel", "hostels", "room", "rooms", "place", "places", "stay", "staying",
  "near", "nearby", "around", "close", "closeby", "beside",
  "in", "at", "on", "of", "to", "for", "with",
  "find", "looking", "look", "search", "searching", "want", "need",
  "please", "show", "me", "is", "are", "there", "i", "my",
]);

/** Drops filler words, keeping the proper nouns a substring search needs. */
function stripFillerWords(query: string): string {
  const kept = query
    .split(/\s+/)
    .filter((word) => !SEARCH_FILLER_WORDS.has(word.toLowerCase().replace(/[^\w]/g, "")));
  const joined = kept.join(" ").trim();
  // A sentence that was nothing but filler words is safer searched whole
  // than reduced to nothing.
  return joined || query;
}

/** "8k" / "8 thousand" / "8,000" / "8 hajar" → 8000. */
export function parseAmount(raw: string, suffix?: string): number {
  const base = Number(raw.replace(/[, ]/g, ""));
  if (!Number.isFinite(base)) {
    return Number.NaN;
  }

  const isThousands = suffix ? /^(k|thousand|hajar|hazar)$/i.test(suffix.trim()) : false;

  // A bare number under 1000 in a rent query is almost always thousands
  // ("under 8" means 8000), while 8000 is already absolute.
  if (isThousands || base < 1000) {
    return base * 1000;
  }

  return base;
}

export const AMOUNT = String.raw`(\d[\d,]*)\s*(k|thousand|hajar|hazar)?`;

function matchArea(query: string): string | undefined {
  // Longest first so "New Baneshwor" wins over "Baneshwor".
  const sorted = [...AREAS].sort((a, b) => b.length - a.length);
  return sorted.find((area) =>
    new RegExp(`\\b${area.replace(/\s+/g, "\\s+")}\\b`, "i").test(query),
  );
}

function matchCollegeArea(query: string): string | undefined {
  for (const college of NEPAL_COLLEGES) {
    // Match on the distinctive words of a campus name, ignoring the generic
    // ones so "Pulchowk" or "Xavier" alone is enough.
    const words = college.name
      .replace(/[()]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 4 &&
          !/^(campus|college|university|international|model)$/i.test(word),
      );

    if (words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(query))) {
      return college.name;
    }
  }

  return undefined;
}

/**
 * Deterministic first pass. Cheap, instant and handles the overwhelming
 * majority of real hero searches (an area name, a gender, a budget). Only what
 * this cannot explain is worth spending an LLM call on.
 */
export function parseSearchQuery(input: string): ParsedSearch {
  const query = input.trim();
  const filters: SearchFilters = {};
  // Tracks how much of the sentence we actually accounted for.
  let signals = 0;

  if (!query) {
    return { confidence: 1, filters: {}, rawTextOnly: false, source: "keyword" };
  }

  if (/\bgirls?\b|\bfemale\b|\bladies\b/i.test(query)) {
    filters.type = "GIRLS";
    signals += 1;
  } else if (/\bboys?\b|\bmale\b|\bgents\b/i.test(query)) {
    filters.type = "BOYS";
    signals += 1;
  } else if (/\bco-?living\b|\bco-?ed\b|\bmixed\b/i.test(query)) {
    filters.type = "CO_LIVING";
    signals += 1;
  }

  const area = matchArea(query);
  if (area) {
    filters.area = area;
    signals += 1;
  } else {
    const city = CITIES.find((name) => new RegExp(`\\b${name}\\b`, "i").test(query));
    if (city) {
      filters.area = city;
      signals += 1;
    }
  }

  // A college reference is a location intent; without geo ranking on the
  // listing endpoint, the campus name is the most useful free-text handle.
  const college = matchCollegeArea(query);
  if (college && !filters.area) {
    filters.q = college.split(" (")[0];
    signals += 1;
  }

  const between = query.match(
    new RegExp(String.raw`\bbetween\s+${AMOUNT}\s*(?:-|–|to|and)\s*${AMOUNT}`, "i"),
  );
  const under = query.match(
    new RegExp(
      String.raw`\b(?:under|below|less than|upto|up to|max|within)\s+${AMOUNT}`,
      "i",
    ),
  );
  const over = query.match(
    new RegExp(
      String.raw`\b(?:above|over|more than|at least|min|minimum)\s+${AMOUNT}`,
      "i",
    ),
  );
  const range = query.match(
    new RegExp(String.raw`\b${AMOUNT}\s*(?:-|–|to)\s*${AMOUNT}`, "i"),
  );

  if (between) {
    filters.minPrice = parseAmount(between[1], between[2]);
    filters.maxPrice = parseAmount(between[3], between[4]);
    signals += 1;
  } else if (under) {
    filters.maxPrice = parseAmount(under[1], under[2]);
    signals += 1;
  } else if (over) {
    filters.minPrice = parseAmount(over[1], over[2]);
    signals += 1;
  } else if (range) {
    filters.minPrice = parseAmount(range[1], range[2]);
    filters.maxPrice = parseAmount(range[3], range[4]);
    signals += 1;
  } else if (/\bcheap\w*\b|\baffordable\b|\bbudget\b|\bsasto\b/i.test(query)) {
    // A soft budget hint rather than a stated number.
    filters.maxPrice = 8000;
    signals += 1;
  }

  if (/\bveg(?:etarian)?\b/i.test(query) && !/\bnon-?\s?veg/i.test(query)) {
    filters.food = "veg";
    signals += 1;
  } else if (/\bnon-?\s?veg\w*\b/i.test(query)) {
    filters.food = "non-veg";
    signals += 1;
  }

  const facility = FACILITY_ALIASES.find(([pattern]) => pattern.test(query));
  if (facility) {
    [, filters.facility] = facility;
    signals += 1;
  }

  const roomType = ROOM_TYPE_ALIASES.find(([pattern]) => pattern.test(query));
  if (roomType) {
    [, filters.roomType] = roomType;
    signals += 1;
  }

  // Words the passes above consumed. Whatever is left over is what an LLM
  // could still explain — a lot of leftovers means low confidence.
  const consumed = [filters.area, filters.facility, filters.roomType, filters.q]
    .filter(Boolean)
    .join(" ");
  const words = query.split(/\s+/).filter((word) => word.length > 2);
  const leftover = words.filter(
    (word) => !new RegExp(word.replace(/[^\w]/g, ""), "i").test(consumed),
  );

  // One clean signal on a short query is plenty; a long sentence that yielded
  // nothing should go to the model.
  const confidence =
    signals === 0
      ? 0
      : Math.min(1, signals / Math.max(1, Math.ceil(leftover.length / 2)));

  // Always keep the raw text as a free-text fallback so a name search still
  // works when nothing structured matched.
  const rawTextOnly = !filters.q && signals === 0;
  if (rawTextOnly) {
    filters.q = stripFillerWords(query).slice(0, 160);
  }

  return { confidence, filters, rawTextOnly, source: "keyword" };
}
