"use client";

import { useQuery } from "@tanstack/react-query";

import type { PublicHostel } from "@/app/_components/public-hostel-data";
import { browserApi } from "@/lib/browser-api";

export type PublicHostelQueryParams = {
  area?: string;
  facility?: string;
  /** Dietary preference filter — matches publicHostelListQuerySchema. */
  food?: "veg" | "non-veg";
  maxPrice?: string;
  minPrice?: string;
  q?: string;
  roomType?: string;
  type?: string;
};

function toSearchString(params: PublicHostelQueryParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  return search.toString();
}

/** Public hostel listing (server state via TanStack Query). */
export function useHostels(params: PublicHostelQueryParams = {}) {
  const qs = toSearchString(params);

  return useQuery({
    queryFn: () =>
      browserApi<{ hostels: PublicHostel[] }>(
        `/api/v1/public/hostels${qs ? `?${qs}` : ""}`,
      ),
    queryKey: ["public-hostels", qs],
  });
}

/** Side-by-side comparison payload for 2–3 hostels. */
export function useCompareHostels(ids: string[]) {
  const key = ids.join(",");

  return useQuery({
    enabled: ids.length >= 2,
    queryFn: () =>
      browserApi<{ hostels: PublicHostel[] }>(
        `/api/v1/public/hostels/compare?ids=${encodeURIComponent(key)}`,
      ),
    queryKey: ["public-hostels-compare", key],
  });
}
