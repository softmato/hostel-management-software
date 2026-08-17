import type { PublicHostel } from "@/lib/public-api";

/**
 * The home screen's stats band, computed from the listing payload.
 *
 * ## Why these are derived and not typed in
 *
 * The mockup — and `public-home-page.tsx` on the web — draw this band with
 * hard-coded copy: "500+ Verified Hostels", "10,000+ Happy Students", "50+
 * Cities Covered", "4.6 ★". None of it comes from anywhere, and none of it is
 * true yet. Agreed with the product owner 2026-08-17: mobile shows the real
 * figures instead, from the same `/public/hostels` response the cards above
 * already render, so the band costs no extra request and cannot drift from the
 * list beneath it.
 *
 * "Happy Students" has no honest equivalent — nothing counts students — so the
 * fourth tile is **vacant beds**, which is a real number and is the one a
 * person looking for a room actually wants.
 *
 * ## The list is capped at 60
 *
 * `/public/hostels` returns the first 60 rows, so these are figures for what is
 * on screen, not for the whole database. The labels say "listed" rather than
 * "total" for that reason. When the dataset outgrows the cap this needs a
 * server-side count, not a bigger page.
 */

export type HomeStat = {
  label: string;
  value: string;
};

/** `1234` → `1,234`. Hand-rolled for the same reason `lib/format.ts` is. */
function group(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function verifiedCount(hostels: PublicHostel[]): number {
  return hostels.filter((hostel) => hostel.verificationStatus === "VERIFIED").length;
}

/**
 * Distinct cities. Falls back to `area` when a hostel has no city, since an
 * address is required but the city field is not — counting only populated
 * cities would under-report coverage.
 */
export function cityCount(hostels: PublicHostel[]): number {
  const cities = new Set<string>();

  for (const hostel of hostels) {
    const name = (hostel.location.city || hostel.location.area || "").trim();

    if (name) {
      cities.add(name.toLowerCase());
    }
  }

  return cities.size;
}

export function vacantBeds(hostels: PublicHostel[]): number {
  return hostels.reduce(
    (total, hostel) => total + (hostel.capacitySummary.vacantBeds ?? 0),
    0,
  );
}

/**
 * Mean rating **weighted by review count**, across rated hostels only.
 *
 * A plain average of averages lets one hostel with a single five-star review
 * outweigh one with two hundred reviews at 4.2. Hostels with `total === 0` are
 * excluded rather than counted as zero — every unrated hostel's average is `0`,
 * and including them would drag the figure toward zero as the platform grows.
 *
 * Returns `null` when nothing has been reviewed, so the caller can drop the
 * tile instead of printing `0.0 ★`.
 */
export function averageRating(hostels: PublicHostel[]): number | null {
  let weighted = 0;
  let reviews = 0;

  for (const hostel of hostels) {
    const { averageRating: average, total } = hostel.ratingSummary;

    if (total > 0) {
      weighted += average * total;
      reviews += total;
    }
  }

  return reviews > 0 ? weighted / reviews : null;
}

/**
 * The band, ready to render. Tiles with nothing behind them are omitted, so an
 * empty or unrated catalogue shows fewer tiles rather than a row of zeros.
 */
export function homeStats(hostels: PublicHostel[]): HomeStat[] {
  if (hostels.length === 0) {
    return [];
  }

  const stats: HomeStat[] = [];
  const verified = verifiedCount(hostels);
  const cities = cityCount(hostels);
  const beds = vacantBeds(hostels);
  const rating = averageRating(hostels);

  if (verified > 0) {
    stats.push({ label: "Verified hostels", value: group(verified) });
  }

  if (cities > 0) {
    stats.push({ label: cities === 1 ? "City covered" : "Cities covered", value: group(cities) });
  }

  if (beds > 0) {
    stats.push({ label: "Beds available", value: group(beds) });
  }

  if (rating !== null) {
    stats.push({ label: "Average rating", value: `${rating.toFixed(1)} ★` });
  }

  return stats;
}
