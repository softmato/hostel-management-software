"use client";

import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

import type { Coordinates, NearbyPlace } from "@/lib/maps/types";

import "leaflet/dist/leaflet.css";

const TYPE_COLORS: Record<string, string> = {
  bus_stop: "#f59e0b",
  college: "#2563eb",
  gym: "#7c3aed",
  hospital: "#dc2626",
  other: "#64748b",
  park: "#16a34a",
  pharmacy: "#db2777",
  restaurant: "#ea580c",
};

export function LeafletMap({
  center,
  name,
  nearby = [],
}: {
  center: Coordinates;
  name: string;
  nearby?: NearbyPlace[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }

      const map = L.map(containerRef.current, {
        center: [center.lat, center.lng],
        scrollWheelZoom: false,
        zoom: 15,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Avoid Leaflet's default marker image (which breaks under bundlers).
      const hostelIcon = L.divIcon({
        className: "",
        html: '<div style="width:18px;height:18px;border-radius:9999px;background:#0d9488;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconAnchor: [9, 9],
        iconSize: [18, 18],
      });
      L.marker([center.lat, center.lng], { icon: hostelIcon }).addTo(map).bindPopup(name);

      for (const place of nearby) {
        L.circleMarker([place.coordinates.lat, place.coordinates.lng], {
          color: TYPE_COLORS[place.type] ?? TYPE_COLORS.other,
          fillColor: TYPE_COLORS[place.type] ?? TYPE_COLORS.other,
          fillOpacity: 0.8,
          radius: 5,
          weight: 1,
        })
          .addTo(map)
          .bindPopup(`${place.name} · ${place.distance}m`);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [center.lat, center.lng, name, nearby]);

  return <div className="h-full w-full" ref={containerRef} />;
}
