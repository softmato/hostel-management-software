/**
 * URL slugs for places: "Kathmandu" → `kathmandu`, "New Baneshwor" →
 * `new-baneshwor`. Owners type city and area names freely, so a slug is matched
 * back to a name by comparing slugs, never by trusting the URL's spelling.
 */
export function locationSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The hostel types a location page can be narrowed to, in URL form. */
export const HOSTEL_TYPE_PAGES = [
  { label: "Boys hostels", slug: "boys", type: "BOYS" },
  { label: "Girls hostels", slug: "girls", type: "GIRLS" },
  { label: "Co-living hostels", slug: "co-living", type: "CO_LIVING" },
] as const;

export type HostelTypePage = (typeof HOSTEL_TYPE_PAGES)[number];

export function hostelTypePage(slug: string): HostelTypePage | null {
  return HOSTEL_TYPE_PAGES.find((page) => page.slug === slug) ?? null;
}

type HostelTypeKey = HostelTypePage["type"];

/** One row of `listPublicHostelLocations`: published hostels counted by place and type. */
export type LocationCountRow = {
  area: string;
  city: string;
  count: number;
  hostelType: string;
  updatedAt: Date | string | null;
};

export type CityIndexEntry = {
  areas: Array<{ count: number; name: string; slug: string }>;
  count: number;
  name: string;
  slug: string;
  types: Record<HostelTypeKey, number>;
  updatedAt: Date | null;
};

/**
 * Every city a location page can exist for: the cities the platform is open in
 * (Website Config → Locations) plus any city a published hostel names. A
 * configured city with nothing in it yet still gets its page — `noindex` until
 * the first hostel arrives — so the launch plan and the link structure are
 * ready before the listings are.
 *
 * An area whose slug is its city's, or a type's (`boys`), would collide with
 * those pages, so it is left out as an area; its hostels still count for the city.
 */
export function buildCityIndex(
  rows: LocationCountRow[],
  configured: Array<{ areas: string[]; city: string }>,
): CityIndexEntry[] {
  const cities = new Map<string, CityIndexEntry>();

  function cityEntry(name: string) {
    const slug = locationSlug(name);
    if (!slug) return null;

    let entry = cities.get(slug);
    if (!entry) {
      entry = {
        areas: [],
        count: 0,
        name,
        slug,
        types: { BOYS: 0, CO_LIVING: 0, GIRLS: 0 },
        updatedAt: null,
      };
      cities.set(slug, entry);
    }

    return entry;
  }

  function addArea(entry: CityIndexEntry, name: string, count: number) {
    const slug = locationSlug(name);
    if (!slug || slug === entry.slug || hostelTypePage(slug)) return;

    const area = entry.areas.find((existing) => existing.slug === slug);
    if (area) {
      area.count += count;
    } else {
      entry.areas.push({ count, name, slug });
    }
  }

  // Configured spellings first, so "Kathmandu" beats a hostel's "kathmandu".
  for (const location of configured) {
    const entry = cityEntry(location.city);
    if (!entry) continue;
    for (const area of location.areas) addArea(entry, area, 0);
  }

  for (const row of rows) {
    const entry = cityEntry(row.city);
    if (!entry) continue;

    entry.count += row.count;
    if (row.hostelType in entry.types) {
      entry.types[row.hostelType as HostelTypeKey] += row.count;
    }
    if (row.area) addArea(entry, row.area, row.count);

    const updated = row.updatedAt ? new Date(row.updatedAt) : null;
    if (updated && (!entry.updatedAt || updated > entry.updatedAt)) {
      entry.updatedAt = updated;
    }
  }

  const byCount = <T extends { count: number; name: string }>(a: T, b: T) =>
    b.count - a.count || a.name.localeCompare(b.name);

  for (const entry of cities.values()) entry.areas.sort(byCount);

  return [...cities.values()].sort(byCount);
}

/** "Boys hostel" / "Girls hostel" / "Co-living hostel", for one hostel's type. */
export function hostelTypeLabel(type: string | undefined) {
  const page = HOSTEL_TYPE_PAGES.find((entry) => entry.type === type);

  return page ? page.label.replace(/s$/, "") : "Hostel";
}
