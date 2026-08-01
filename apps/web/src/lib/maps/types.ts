export type MapProvider = "google" | "osm";

export type Coordinates = { lat: number; lng: number };

export type NearbyPlaceType =
  | "college"
  | "hospital"
  | "bus_stop"
  | "park"
  | "gym"
  | "restaurant"
  | "pharmacy"
  | "other";

export type NearbyPlace = {
  coordinates: Coordinates;
  distance: number; // meters from the hostel
  name: string;
  type: NearbyPlaceType;
};

/**
 * Where a hostel's coordinates came from. MANUAL pins are authored by an admin
 * dragging the map marker and are never overwritten by the geocoder.
 */
export type LocationSource = "MANUAL" | "GEOCODED";

/**
 * `exact` means the geocoder matched the full street address. `approximate`
 * means only the coarser area/city query resolved, so the pin is a locality
 * centroid and the admin should be prompted to place it precisely.
 */
export type GeocodePrecision = "exact" | "approximate";

/**
 * The address fields a hostel carries. Lives here rather than in `geocoding.ts`
 * because both directions use it: forward lookups take it, and reverse lookups
 * hand it back so the admin's address fields can follow the map pin.
 */
export type AddressParts = {
  address?: string;
  area?: string;
  city?: string;
  country?: string;
  province?: string;
};

export type GeocodeResult = {
  /** Structured address of the match, when the provider returned one. */
  address?: AddressParts;
  coordinates: Coordinates;
  /** Human-readable match the provider returned, for search result lists. */
  label?: string;
  precision: GeocodePrecision;
};
