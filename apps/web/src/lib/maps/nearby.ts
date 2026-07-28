import type { Coordinates, NearbyPlace, NearbyPlaceType } from "./types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 1500;
const MAX_RESULTS = 18;

export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Points of interest near a hostel (colleges, hospitals, bus stops). Prefers
 * Google Places when a key is set, otherwise the free Overpass (OpenStreetMap)
 * API. Results are meant to be cached on the Hostel document, not fetched per
 * page view (ARCHITECTURE.md §4.5).
 */
export async function fetchNearbyPlaces(center: Coordinates): Promise<NearbyPlace[]> {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const viaGoogle = await fetchNearbyWithGoogle(center).catch(() => null);
    if (viaGoogle && viaGoogle.length > 0) {
      return viaGoogle;
    }
  }

  return fetchNearbyWithOverpass(center).catch(() => []);
}

type OverpassElement = {
  center?: { lat: number; lon: number };
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function classifyOverpass(tags: Record<string, string>): NearbyPlaceType {
  const amenity = tags.amenity ?? "";
  const highway = tags.highway ?? "";
  const leisure = tags.leisure ?? "";
  if (amenity === "college" || amenity === "university" || amenity === "school") {
    return "college";
  }
  if (amenity === "hospital" || amenity === "clinic") {
    return "hospital";
  }
  if (highway === "bus_stop" || tags.public_transport === "platform") {
    return "bus_stop";
  }
  if (leisure === "park" || leisure === "garden") {
    return "park";
  }
  if (leisure === "fitness_centre" || leisure === "sports_centre") {
    return "gym";
  }
  if (amenity === "restaurant" || amenity === "cafe" || amenity === "fast_food") {
    return "restaurant";
  }
  if (amenity === "pharmacy") {
    return "pharmacy";
  }
  return "other";
}

async function fetchNearbyWithOverpass(center: Coordinates): Promise<NearbyPlace[]> {
  const r = SEARCH_RADIUS_METERS;
  const { lat, lng } = center;
  const query = `[out:json][timeout:20];(
    node["amenity"~"college|university|school|hospital|clinic|restaurant|cafe|fast_food|pharmacy"](around:${r},${lat},${lng});
    way["amenity"~"college|university|hospital"](around:${r},${lat},${lng});
    node["highway"="bus_stop"](around:${r},${lat},${lng});
    node["leisure"~"park|garden|fitness_centre|sports_centre"](around:${r},${lat},${lng});
    way["leisure"~"park|garden"](around:${r},${lat},${lng});
  );out center ${MAX_RESULTS * 4};`;

  const response = await fetch(OVERPASS_URL, {
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { elements?: OverpassElement[] };

  const places = (data.elements ?? [])
    .map((element): NearbyPlace | null => {
      const tags = element.tags ?? {};
      const name = tags.name;
      if (!name) {
        return null;
      }
      const lat2 = element.lat ?? element.center?.lat;
      const lng2 = element.lon ?? element.center?.lon;
      if (lat2 === undefined || lng2 === undefined) {
        return null;
      }
      const coordinates = { lat: lat2, lng: lng2 };
      return {
        coordinates,
        distance: haversineMeters(center, coordinates),
        name,
        type: classifyOverpass(tags),
      };
    })
    .filter((place): place is NearbyPlace => place !== null);

  // De-duplicate by name, keep the closest, sort by distance, cap.
  const byName = new Map<string, NearbyPlace>();
  for (const place of places) {
    const existing = byName.get(place.name);
    if (!existing || place.distance < existing.distance) {
      byName.set(place.name, place);
    }
  }

  return [...byName.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_RESULTS);
}

type GooglePlacesResponse = {
  results?: Array<{
    geometry: { location: { lat: number; lng: number } };
    name: string;
  }>;
};

const GOOGLE_PLACE_TYPES: { type: string; kind: NearbyPlaceType }[] = [
  { kind: "college", type: "university" },
  { kind: "hospital", type: "hospital" },
  { kind: "bus_stop", type: "bus_station" },
  { kind: "park", type: "park" },
  { kind: "gym", type: "gym" },
  { kind: "restaurant", type: "restaurant" },
  { kind: "pharmacy", type: "pharmacy" },
];

async function fetchNearbyWithGoogle(center: Coordinates): Promise<NearbyPlace[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return [];
  }

  const perType = await Promise.all(
    GOOGLE_PLACE_TYPES.map(async ({ kind, type }) => {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${center.lat},${center.lng}&radius=${SEARCH_RADIUS_METERS}` +
        `&type=${type}&key=${key}`;
      const response = await fetch(url).catch(() => null);
      if (!response || !response.ok) {
        return [];
      }
      const data = (await response.json()) as GooglePlacesResponse;
      return (data.results ?? []).slice(0, 5).map((result): NearbyPlace => {
        const coordinates = result.geometry.location;
        return {
          coordinates,
          distance: haversineMeters(center, coordinates),
          name: result.name,
          type: kind,
        };
      });
    }),
  );

  return perType
    .flat()
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_RESULTS);
}
