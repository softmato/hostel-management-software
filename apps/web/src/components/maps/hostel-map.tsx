"use client";

import dynamic from "next/dynamic";

import { useMapProvider } from "@/lib/maps/use-map-provider";
import type { Coordinates, NearbyPlace } from "@/lib/maps/types";

function MapSkeleton() {
  return <div className="h-full w-full animate-pulse bg-muted" />;
}

// Leaflet touches `window`, so never render it on the server.
const LeafletMap = dynamic(() => import("./leaflet-map").then((mod) => mod.LeafletMap), {
  loading: MapSkeleton,
  ssr: false,
});
const GoogleMap = dynamic(() => import("./google-map").then((mod) => mod.GoogleMap), {
  loading: MapSkeleton,
  ssr: false,
});

/**
 * Renders a hostel's location. Provider is chosen at runtime (Google when a
 * browser key is configured, else OpenStreetMap/Leaflet — ARCHITECTURE.md §4).
 */
export function HostelMap({
  center,
  name,
  nearby,
}: {
  center: Coordinates;
  name: string;
  nearby?: NearbyPlace[];
}) {
  const provider = useMapProvider();

  return provider === "google" ? (
    <GoogleMap center={center} name={name} />
  ) : (
    <LeafletMap center={center} name={name} nearby={nearby} />
  );
}
