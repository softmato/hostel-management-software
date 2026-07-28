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
