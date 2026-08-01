import type { AddressParts, Coordinates, GeocodeResult } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
// Nominatim usage policy requires an identifying User-Agent (ARCHITECTURE.md §4.7).
const USER_AGENT = "HostelHub/1.0 (hostel discovery; +https://hostelhub.app)";

export type { AddressParts };

export function buildAddressQuery(parts: AddressParts): string {
  return [parts.address, parts.area, parts.city, parts.province, parts.country ?? "Nepal"]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Address → coordinates. Server-only (protects the API key). Prefers Google
 * when a server key is set, otherwise Nominatim (OpenStreetMap). Returns null on
 * any failure so callers can degrade gracefully.
 *
 * The result carries a `precision`: `approximate` means only the coarse
 * area/city query resolved, so the pin is a locality centroid rather than the
 * building. Callers surface that so an admin knows to drop the pin by hand —
 * an approximate pin is exactly how a hostel ends up appearing to sit in some
 * unrelated part of the neighbourhood.
 */
export async function geocodeAddress(parts: AddressParts): Promise<GeocodeResult | null> {
  // Try the full address first, then fall back to a coarser area/city query.
  // Many Nepali addresses have vague or placeholder streets that geocoders
  // can't resolve verbatim — the coarser query still pins the right locality.
  const full = buildAddressQuery(parts);
  const coarse = buildAddressQuery({
    area: parts.area,
    city: parts.city,
    country: parts.country,
    province: parts.province,
  });
  const queries = [full, coarse].filter(
    (query, index, all) => query.length > 0 && all.indexOf(query) === index,
  );

  for (const [index, query] of queries.entries()) {
    // Only the first query carries the street line; anything after it is the
    // coarse locality fallback.
    const precision = index === 0 && query !== coarse ? "exact" : "approximate";
    const [match] = await searchPlaces(query, 1);
    if (match) {
      return { ...match, precision };
    }
  }

  return null;
}

/**
 * Progressively coarser forms of a place query, most specific first.
 *
 * Two things break a literal lookup. Duplicated components — a hostel whose
 * `address` and `area` are both "Narephat" produces "Narephat, Narephat,
 * Kathmandu, Nepal", which resolves to nothing — and over-specific street lines
 * that Nepali map data simply does not carry. Deduplicating, then dropping
 * leading components one at a time, turns both into a hit near the right place
 * rather than an empty result the admin can do nothing with.
 */
export function queryVariants(raw: string): string[] {
  const seen = new Set<string>();
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return [...new Set(parts.map((_, index) => parts.slice(index).join(", ")))];
}

/**
 * Free-text place lookup returning ranked candidates. Backs the admin location
 * picker's search box, so it returns several options rather than just the top
 * hit. Server-only — never call from the browser, it would leak the server key.
 */
export async function searchPlaces(query: string, limit = 5): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    const viaGoogle = await searchWithGoogle(trimmed, limit).catch(() => []);
    if (viaGoogle.length > 0) {
      return viaGoogle;
    }
  }

  return searchWithNominatim(trimmed, limit).catch(() => []);
}

/**
 * Coordinates → address. Backs the admin location picker: whatever the pin is
 * moved onto — a search hit, a pasted Google Maps link, the device's own
 * position — the address fields above the map follow it, so the listing text
 * and the pin cannot describe two different places.
 *
 * Returns null on any failure; the pin is still valid without the text.
 */
export async function reverseGeocode(
  coordinates: Coordinates,
): Promise<{ address: AddressParts; label?: string } | null> {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const viaGoogle = await reverseWithGoogle(coordinates).catch(() => null);
    if (viaGoogle) {
      return viaGoogle;
    }
  }

  return reverseWithNominatim(coordinates).catch(() => null);
}

/**
 * Nominatim's `address` object, flattened to our fields. The alternatives per
 * field are not interchangeable synonyms — which key is populated depends on
 * how the locality is classified in OSM, and Nepali data uses all of them.
 */
type NominatimAddress = Record<string, string | undefined>;

/** First populated key, in priority order. */
function pick(source: NominatimAddress, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** Nepali administrative suffixes that geocoders append to city/province names. */
const ADMIN_SUFFIX =
  /\s+(sub[- ]metropolitan city|metropolitan city|rural municipality|municipality|province|district)$/i;

/**
 * "Kathmandu Metropolitan City" → "Kathmandu", "Bagamati Province" → "Bagamati".
 *
 * The city field is what the public listing filters on, and every hostel
 * already stored says "Kathmandu" — writing the geocoder's full administrative
 * name into it would quietly drop the hostel out of its own city's results.
 */
export function tidyPlaceName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.replace(ADMIN_SUFFIX, "").trim();
  return trimmed || value.trim();
}

function addressPartsFromNominatim(address: NominatimAddress | undefined): AddressParts {
  if (!address) {
    return {};
  }

  const parts: AddressParts = {
    address: [address.house_number, address.road].filter(Boolean).join(" ").trim() || undefined,
    area: pick(address, [
      "neighbourhood",
      "suburb",
      "quarter",
      "hamlet",
      "village",
      "city_district",
    ]),
    city: tidyPlaceName(pick(address, ["city", "town", "municipality", "county"])),
    country: pick(address, ["country"]),
    province: tidyPlaceName(pick(address, ["state", "region"])),
  };

  return definedParts(parts);
}

/** Drops the keys the provider had nothing for, so callers can spread safely. */
function definedParts(parts: AddressParts): AddressParts {
  return Object.fromEntries(
    Object.entries(parts).filter(([, value]) => Boolean(value)),
  ) as AddressParts;
}

async function reverseWithNominatim(
  coordinates: Coordinates,
): Promise<{ address: AddressParts; label?: string } | null> {
  const url =
    `${NOMINATIM_REVERSE_URL}?format=jsonv2&addressdetails=1&zoom=18` +
    `&lat=${coordinates.lat}&lon=${coordinates.lng}`;
  const response = await fetch(url, {
    headers: { "Accept-Language": "en", "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    address?: NominatimAddress;
    display_name?: string;
  };

  const address = addressPartsFromNominatim(data.address);
  if (Object.keys(address).length === 0) {
    return null;
  }

  return { address, ...(data.display_name ? { label: data.display_name } : {}) };
}

async function reverseWithGoogle(
  coordinates: Coordinates,
): Promise<{ address: AddressParts; label?: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return null;
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${coordinates.lat},${coordinates.lng}&key=${key}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    results?: Array<{
      address_components?: GoogleAddressComponent[];
      formatted_address?: string;
    }>;
  };

  const [best] = data.results ?? [];
  if (!best) {
    return null;
  }

  const address = addressPartsFromGoogle(best.address_components);
  if (Object.keys(address).length === 0) {
    return null;
  }

  return { address, ...(best.formatted_address ? { label: best.formatted_address } : {}) };
}

async function searchWithNominatim(query: string, limit: number): Promise<GeocodeResult[]> {
  const url =
    `${NOMINATIM_URL}?format=json&addressdetails=1&limit=${limit}` +
    `&countrycodes=np&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "Accept-Language": "en", "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as Array<{
    address?: NominatimAddress;
    display_name?: string;
    lat: string;
    lon: string;
  }>;

  return data.map((item) => ({
    address: addressPartsFromNominatim(item.address),
    coordinates: { lat: Number(item.lat), lng: Number(item.lon) },
    label: item.display_name,
    // Callers that care about street-level accuracy set this themselves; a raw
    // search hit is only ever as good as what the user typed.
    precision: "approximate" as const,
  }));
}

async function searchWithGoogle(query: string, limit: number): Promise<GeocodeResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return [];
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}&region=np&key=${key}`;
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as {
    results?: Array<{
      address_components?: GoogleAddressComponent[];
      formatted_address?: string;
      geometry: { location: Coordinates };
    }>;
  };

  return (data.results ?? []).slice(0, limit).map((result) => ({
    address: addressPartsFromGoogle(result.address_components),
    coordinates: result.geometry.location,
    label: result.formatted_address,
    precision: "approximate" as const,
  }));
}

type GoogleAddressComponent = { long_name?: string; types?: string[] };

/**
 * Google returns the address as a bag of typed components rather than named
 * fields, so each of ours is the first component carrying one of its types.
 */
function addressPartsFromGoogle(components: GoogleAddressComponent[] | undefined): AddressParts {
  if (!components?.length) {
    return {};
  }

  const of = (...types: string[]) =>
    components.find((component) => component.types?.some((type) => types.includes(type)))
      ?.long_name;

  const street = [of("street_number"), of("route")].filter(Boolean).join(" ").trim();

  return definedParts({
    address: street || of("premise", "point_of_interest"),
    area: of("sublocality_level_1", "sublocality", "neighborhood", "ward"),
    city: tidyPlaceName(of("locality", "administrative_area_level_2", "postal_town")),
    country: of("country"),
    province: tidyPlaceName(of("administrative_area_level_1")),
  });
}
