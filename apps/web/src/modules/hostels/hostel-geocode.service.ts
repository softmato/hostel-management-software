import { queryVariants, reverseGeocode, searchPlaces } from "@/lib/maps/geocoding";
import { parseMapLink, resolveShortLink, type ParsedMapLink } from "@/lib/maps/map-links";
import type { GeocodeResult } from "@/lib/maps/types";

/**
 * Location lookup for every map picker on the platform, in both directions.
 *
 * It lives here rather than inside a route because two desks place the same pin
 * on the same map: a hostel admin correcting their own listing, and a team agent
 * standing in a hostel that does not exist yet and therefore has no hostel
 * capability to be checked against. The lookup is identical; only the guard
 * differs, so only the guard belongs in the route.
 *
 * Server-side in both cases, so the Google key is never exposed and the
 * Nominatim User-Agent policy is honoured (ARCHITECTURE.md §4.7).
 */
export async function lookupLocation(input: {
  lat?: number;
  limit: number;
  lng?: number;
  near?: string;
  q?: string;
}): Promise<{ results: GeocodeResult[] }> {
  if (!input.q) {
    // Reverse: which address does this pin sit on? Callers guarantee the pair.
    const resolved = await reverseGeocode({ lat: input.lat!, lng: input.lng! });

    return {
      results: resolved
        ? [
            {
              address: resolved.address,
              coordinates: { lat: input.lat!, lng: input.lng! },
              ...(resolved.label ? { label: resolved.label } : {}),
              precision: "exact" as const,
            },
          ]
        : [],
    };
  }

  const link = await resolvePastedLink(input.q);

  if (link?.kind === "coordinates") {
    // A pasted pin is somebody telling us the exact spot, so it is one result,
    // not a candidate list — but it still needs an address attached.
    const resolved = await reverseGeocode(link.coordinates);

    return {
      results: [
        {
          ...(resolved ? { address: resolved.address } : {}),
          coordinates: link.coordinates,
          label: link.label ?? resolved?.label,
          precision: "exact" as const,
        } satisfies GeocodeResult,
      ],
    };
  }

  return {
    results: await searchCandidates(
      link?.kind === "place" ? link.query : input.q,
      input.near,
      input.limit,
    ),
  };
}

/** A pasted link, with shorteners followed. Null for ordinary text queries. */
async function resolvePastedLink(q: string): Promise<ParsedMapLink | null> {
  const parsed = parseMapLink(q);

  if (parsed?.kind !== "shortLink") {
    return parsed;
  }

  return resolveShortLink(parsed.url);
}

/**
 * Search, widening until something resolves.
 *
 * People type the hostel's own name ("Royal Rapti Boys Hostel"), which no
 * geocoder in Nepal carries on its own — appending the locality is what turns
 * that into a hit near the right place instead of an empty list and a map that
 * never moved.
 */
async function searchCandidates(
  q: string,
  near: string | undefined,
  limit: number,
): Promise<GeocodeResult[]> {
  const attempts = [...queryVariants(q), ...(near ? queryVariants(`${q}, ${near}`) : [])];

  // Stop at the first attempt that resolves — a street-level hit beats a city
  // centroid, so never merge the tiers together.
  const seen = new Set<string>();

  for (const attempt of attempts) {
    const key = attempt.toLowerCase();

    // The bare country is the end of the widening chain and would drop the pin
    // in the middle of Nepal, which is worse than showing nothing.
    if (seen.has(key) || key === "nepal") {
      continue;
    }

    seen.add(key);

    const results = await searchPlaces(attempt, limit);

    if (results.length > 0) {
      return results;
    }
  }

  return [];
}
