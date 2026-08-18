/**
 * Deriving the home screen's sections from the one listing payload it already
 * holds.
 *
 * `/public/hostels` returns the first 60 rows, cheapest-first, with no
 * pagination — so every row on the home screen is a *slice of one request*
 * rather than a round trip per heading. That is what keeps a screen with six
 * carousels to a single fetch, and it is also the honest limit on all of it: the
 * counts below describe what came back, not the whole database.
 *
 * These live in `lib/` so they can be tested. Vitest runs node-side with no
 * React Native shim, so anything that imports `react-native` is untestable by
 * construction, and the grouping is the part worth a test — a city that appears
 * under two spellings, or a showcase that leads with a hostel that has no photo.
 *
 * This file replaced `home-stats.ts`, which computed the mockup's "500+ Verified
 * Hostels" band from real figures. The band is gone: the home screen is a
 * listings screen, and a row of platform statistics is furniture, however true
 * the numbers were.
 */

import { coverPhoto } from "@/lib/hostel-display";
import type { PublicHostel } from "@/lib/public-api";

export type CitySummary = {
  city: string;
  count: number;
};

/**
 * Cities, busiest first, with how many listings each has.
 *
 * Falls back to `area` when a hostel has no city, because the address is
 * required server-side and the city field is not — dropping those would hide
 * real listings from a section whose whole job is to lead people to them.
 *
 * Grouped case-insensitively so "kathmandu" and "Kathmandu" are one row, and the
 * **first spelling seen wins** as the label: the payload is cheapest-first, so
 * this is stable across renders of the same response rather than a coin flip
 * between two capitalisations.
 *
 * Ties break alphabetically. Sorting by count alone would let two equal cities
 * swap places between two fetches of identical data, which reads as the list
 * flickering.
 */
export function cityCounts(hostels: PublicHostel[]): CitySummary[] {
  const found = new Map<string, CitySummary>();

  for (const hostel of hostels) {
    const name = (hostel.location.city || hostel.location.area || "").trim();

    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existing = found.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      found.set(key, { city: name, count: 1 });
    }
  }

  return [...found.values()].sort(
    (a, b) => b.count - a.count || a.city.localeCompare(b.city),
  );
}

/**
 * The hostels worth putting in the auto-sliding showcase at 200px tall.
 *
 * **A photo is the entry requirement**, not a preference. The showcase is one
 * large image per card; a hostel without one renders as a grey box with an icon
 * in it, and at that size it is the most prominent thing on the screen.
 *
 * Among those, verified listings lead, then the best rated. An unreviewed hostel
 * sorts below a rated one rather than being excluded — a young catalogue would
 * otherwise have an empty showcase — and `total`, not `averageRating`, decides
 * whether a hostel counts as rated, because every average is `0` before the
 * first review.
 */
export function showcaseHostels(hostels: PublicHostel[], limit = 6): PublicHostel[] {
  return hostels
    .filter((hostel) => coverPhoto(hostel.photos) !== null)
    .sort((a, b) => {
      const verified =
        Number(b.verificationStatus === "VERIFIED") -
        Number(a.verificationStatus === "VERIFIED");

      if (verified !== 0) {
        return verified;
      }

      const rated = Number(b.ratingSummary.total > 0) - Number(a.ratingSummary.total > 0);

      if (rated !== 0) {
        return rated;
      }

      return b.ratingSummary.averageRating - a.ratingSummary.averageRating;
    })
    .slice(0, limit);
}

/**
 * Narrows a list to one city, matching `cityCounts`' grouping.
 *
 * **Client-side, and it says so at the call site.** The server's
 * `publicHostelListQuerySchema` has an `area` filter that matches
 * `location.area` only — a hostel in "Ghattekulo, Kathmandu" does not match
 * `?area=Kathmandu` — and no `city` filter at all. This narrows the rows already
 * returned, which is the same trade `Sort: nearest` makes on the browse screen:
 * it genuinely changes what is on screen, and it does not pretend to have
 * narrowed the query. Within the 60-row window the count on the home screen and
 * the results here are computed from the same payload, so they agree.
 */
export function inCity(hostels: PublicHostel[], city: string): PublicHostel[] {
  const wanted = city.trim().toLowerCase();

  if (!wanted) {
    return hostels;
  }

  return hostels.filter((hostel) => {
    const name = (hostel.location.city || hostel.location.area || "").trim();

    return name.toLowerCase() === wanted;
  });
}
