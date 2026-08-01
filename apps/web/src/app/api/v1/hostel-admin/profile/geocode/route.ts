import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import { queryVariants, reverseGeocode, searchPlaces } from "@/lib/maps/geocoding";
import { parseMapLink, resolveShortLink, type ParsedMapLink } from "@/lib/maps/map-links";
import type { GeocodeResult } from "@/lib/maps/types";
import { hostelAdminGeocodeQuerySchema } from "@/modules/hostels/hostel.validation";

export const runtime = "nodejs";

/**
 * Location lookup for the profile location picker, in both directions:
 *
 * - `?q=` — a place name, a pasted Google Maps / OSM link, or a raw `lat,lng`
 *   pair. Links are resolved here because following a `maps.app.goo.gl`
 *   redirect is impossible from the browser (cross-origin).
 * - `?lat=&lng=` — what address that pin sits on, so the address fields can
 *   follow the map.
 *
 * Server-side so the Google key is never exposed and the Nominatim User-Agent
 * policy is honoured (ARCHITECTURE.md §4.7). Staff-only — this is a paid
 * upstream call, not something anonymous traffic should be able to drive.
 */
export async function GET(request: NextRequest) {
  try {
    await requireHostelCapability(request, "editHostelProfile");
    const { lat, limit, lng, near, q } = hostelAdminGeocodeQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    if (!q) {
      // Reverse: `lat`/`lng` are guaranteed present by the schema refinement.
      const resolved = await reverseGeocode({ lat: lat!, lng: lng! });
      return successResponse(
        {
          results: resolved
            ? [
                {
                  address: resolved.address,
                  coordinates: { lat: lat!, lng: lng! },
                  ...(resolved.label ? { label: resolved.label } : {}),
                  precision: "exact" as const,
                },
              ]
            : [],
        },
        "Address lookup complete",
      );
    }

    const link = await resolvePastedLink(q);
    if (link?.kind === "coordinates") {
      // A pasted pin is the admin telling us the exact spot, so it is one
      // result, not a candidate list — but it still needs an address attached.
      const resolved = await reverseGeocode(link.coordinates);
      return successResponse(
        {
          results: [
            {
              ...(resolved ? { address: resolved.address } : {}),
              coordinates: link.coordinates,
              label: link.label ?? resolved?.label,
              precision: "exact" as const,
            } satisfies GeocodeResult,
          ],
        },
        "Map link resolved",
      );
    }

    const results = await searchCandidates(link?.kind === "place" ? link.query : q, near, limit);

    return successResponse({ results }, "Location search complete");
  } catch (error) {
    return handleRouteError(error);
  }
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
 * Admins type their hostel's own name ("Royal Rapti Boys Hostel"), which no
 * geocoder in Nepal carries on its own — appending the saved locality is what
 * turns that into a hit near the right place instead of an empty list and a map
 * that never moved.
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
