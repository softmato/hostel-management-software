import type { Coordinates } from "./types";

export type College = {
  coordinates: Coordinates;
  name: string;
};

/**
 * Curated list of major colleges/universities used by the public listing's
 * "Near my college" filter. Coordinates are approximate campus locations —
 * good enough for proximity ranking (ARCHITECTURE.md §4.6). Extend as needed.
 */
export const NEPAL_COLLEGES: College[] = [
  {
    coordinates: { lat: 27.6786, lng: 85.2876 },
    name: "Tribhuvan University (Kirtipur)",
  },
  { coordinates: { lat: 27.682, lng: 85.3175 }, name: "IOE Pulchowk Campus" },
  {
    coordinates: { lat: 27.6193, lng: 85.5386 },
    name: "Kathmandu University (Dhulikhel)",
  },
  {
    coordinates: { lat: 27.7166, lng: 85.3123 },
    name: "Amrit Science Campus (Lainchaur)",
  },
  { coordinates: { lat: 27.6935, lng: 85.32 }, name: "St. Xavier's College (Maitighar)" },
  {
    coordinates: { lat: 27.7095, lng: 85.322 },
    name: "Islington College (Kamalpokhari)",
  },
  {
    coordinates: { lat: 27.705, lng: 85.328 },
    name: "Trinity International College (Dillibazar)",
  },
  { coordinates: { lat: 27.6667, lng: 85.3333 }, name: "KCM (Gwarko)" },
  {
    coordinates: { lat: 27.7267, lng: 85.34 },
    name: "Kathmandu Model College (Bagbazar)",
  },
  {
    coordinates: { lat: 27.6712, lng: 85.4298 },
    name: "Purwanchal Campus / Bhaktapur MC",
  },
];
