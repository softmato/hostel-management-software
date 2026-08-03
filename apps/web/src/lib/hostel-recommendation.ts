import type { PublicHostel } from "@/app/_components/public-hostel-data";
import type { MyExpertConsultationRequest } from "@/hooks/use-expert-consultation";
import { haversineMeters } from "@/lib/maps/nearby";
import { NEPAL_COLLEGES } from "@/lib/maps/nepal-colleges";
import { AMOUNT, parseAmount } from "@/lib/search/query-parser";

export type HostelMatch = {
  distanceKm: number | null;
  hostel: PublicHostel;
  /** null when there isn't enough data on either side to judge fit. */
  withinBudget: boolean | null;
};

type BudgetRange = { max: number; min: number };

/**
 * "8000-12000" / "8k-12k" / "10000" / "under 10k" → a range. A single figure
 * reads as a ceiling, with headroom below it so hostels just under it aren't
 * excluded. Reuses the hero search's amount grammar (query-parser.ts) rather
 * than reinventing "8k" / "8 thousand" parsing for this free-text field.
 */
export function parseBudgetRange(text: string | null | undefined): BudgetRange | null {
  if (!text?.trim()) {
    return null;
  }

  const range = text.match(new RegExp(String.raw`${AMOUNT}\s*(?:-|–|to)\s*${AMOUNT}`, "i"));
  if (range) {
    const a = parseAmount(range[1], range[2]);
    const b = parseAmount(range[3], range[4]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return { max: Math.max(a, b), min: Math.min(a, b) };
    }
  }

  const single = text.match(new RegExp(AMOUNT, "i"));
  if (single) {
    const value = parseAmount(single[1], single[2]);
    if (Number.isFinite(value) && value > 0) {
      return { max: value, min: value * 0.6 };
    }
  }

  return null;
}

function hostelRentRange(hostel: PublicHostel): BudgetRange | null {
  const fee = hostel.comparison?.monthlyFee;
  const min = fee?.min ?? hostel.pricing?.monthlyRentMin;
  const max = fee?.max ?? hostel.pricing?.monthlyRentMax ?? min;

  if (!min && !max) {
    return null;
  }

  return { max: max ?? min ?? 0, min: min ?? max ?? 0 };
}

/** 1 when the ranges overlap, decaying smoothly (not a hard cliff) as the gap grows. */
function budgetScore(hostel: PublicHostel, budget: BudgetRange | null): number {
  if (!budget) {
    return 0.5;
  }

  const rent = hostelRentRange(hostel);
  if (!rent) {
    return 0.4;
  }

  const overlap = Math.min(budget.max, rent.max) - Math.max(budget.min, rent.min);
  if (overlap >= 0) {
    return 1;
  }

  const gap = -overlap;
  const scale = Math.max(budget.max - budget.min, budget.max * 0.25, 2000);
  return Math.max(0, 1 - gap / scale);
}

/** Kathmandu-valley scale: "walkable" (~1km) scores near 1, ~8km+ trails off. */
function proximityScore(
  hostel: PublicHostel,
  collegeName: string | null | undefined,
): { distanceKm: number | null; score: number } {
  const college = collegeName
    ? NEPAL_COLLEGES.find((item) => item.name === collegeName)
    : undefined;

  if (!college || !hostel.coordinates) {
    return { distanceKm: null, score: 0.5 };
  }

  const distanceKm = haversineMeters(hostel.coordinates, college.coordinates) / 1000;
  return { distanceKm, score: Math.max(0, 1 - distanceKm / 8) };
}

/**
 * Ranks published hostels against a visitor's "Talk to an Expert" answers,
 * using only the two hard signals available on both sides of the data —
 * budget and distance from their preferred college. `environment` and
 * `likedSpots` have no matching hostel field yet, so callers should show
 * those as context under a suggestion rather than treat this ranking as
 * reflecting them.
 */
export function topHostelMatches(
  hostels: PublicHostel[],
  request: Pick<MyExpertConsultationRequest, "budgetRange" | "preferredCollege"> | null,
  limit = 3,
): HostelMatch[] {
  if (!request) {
    return [];
  }

  const budget = parseBudgetRange(request.budgetRange);

  return hostels
    .map((hostel) => {
      const rent = hostelRentRange(hostel);
      const points = budgetScore(hostel, budget);
      const proximity = proximityScore(hostel, request.preferredCollege);

      return {
        distanceKm: proximity.distanceKm,
        hostel,
        rating: hostel.comparison?.ratingSummary?.averageRating ?? 0,
        score: points * 0.5 + proximity.score * 0.5,
        withinBudget: budget && rent ? points >= 1 : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.rating - a.rating)
    .slice(0, limit)
    .map(({ distanceKm, hostel, withinBudget }) => ({ distanceKm, hostel, withinBudget }));
}
