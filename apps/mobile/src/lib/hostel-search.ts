import type { PublicHostel } from "@/lib/public-api";

/**
 * Matching what somebody typed against the hostels already on screen.
 *
 * ## Client-side, and only over what the payload holds
 *
 * The map searches the 60 rows `/public/hostels` returned, not the database and
 * not the world. That is the honest scope of it: every pin the search can
 * produce is a hostel registered on this platform, with a page to open and a
 * price to read. A geocoder would answer "Baneshwor" with a place rather than a
 * listing, which is a map that sends people where the app cannot help them.
 *
 * ## Name, area, city, address — and nothing fuzzy
 *
 * Substring, case-folded, across the four fields somebody actually types. No
 * edit distance and no token scoring: a map that answers "Kritika" with four
 * hostels sharing none of its letters looks broken, where a map that answers
 * with nothing tells the reader to type something else. The empty query returns
 * the array it was given — the same reference, so a memoised caller does not
 * re-render for a cleared search box.
 */
export function searchHostels(hostels: PublicHostel[], query: string): PublicHostel[] {
  const wanted = query.trim().toLowerCase();

  if (!wanted) {
    return hostels;
  }

  return hostels.filter((hostel) => haystack(hostel).includes(wanted));
}

function haystack(hostel: PublicHostel): string {
  return [
    hostel.name,
    hostel.location.area,
    hostel.location.city ?? "",
    hostel.location.address ?? "",
  ]
    .join(" ")
    .toLowerCase();
}
