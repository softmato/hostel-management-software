"use client";

import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

import type { Coordinates } from "@/lib/maps/types";

import "leaflet/dist/leaflet.css";

/**
 * An OpenStreetMap canvas with one draggable marker, used by the hostel admin
 * location picker. Dragging the pin — or clicking anywhere on the map — reports
 * the new coordinates upward; the parent owns the value.
 *
 * Kept separate from LeafletMap because that one is a read-only public display
 * and this one is an input control.
 */
export function DraggablePinMap({
  onChange,
  value,
}: {
  onChange: (next: Coordinates) => void;
  value: Coordinates;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  // Read through a ref inside the Leaflet callbacks so a new `onChange`
  // identity from the parent never forces the map to be torn down and rebuilt.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Latest coordinates, for the deferred build below — by the time the map is
  // actually created the `value` captured at mount may be stale.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Build the map, but only once the container genuinely has a size.
  //
  // This picker sits in a profile section that is mounted but hidden until its
  // tab is opened, and Leaflet caches its container's dimensions at
  // construction. A map built at 0x0 keeps believing it is 0x0 and paints a
  // single corner of tiles forever after. Deferring the build removes that
  // failure mode outright; the observer then keeps the map honest across later
  // resizes (window changes, layout shifts).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    const hasSize = () => container.clientWidth > 0 && container.clientHeight > 0;

    const createMap = async () => {
      if (cancelled || mapRef.current || !hasSize()) {
        return;
      }

      const L = (await import("leaflet")).default;
      if (cancelled || mapRef.current || !containerRef.current) {
        return;
      }

      const start = valueRef.current;
      const map = L.map(container, {
        center: [start.lat, start.lng],
        scrollWheelZoom: false,
        zoom: 17,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Inline SVG marker — Leaflet's default icon points at image files that
      // bundlers rewrite, and a teardrop reads as "drag me" better than a dot.
      const pinIcon = L.divIcon({
        className: "",
        html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 39C15 39 28 24.5 28 14.5A13 13 0 1 0 2 14.5C2 24.5 15 39 15 39Z"
            fill="#0d9488" stroke="white" stroke-width="2.5" />
          <circle cx="15" cy="14.5" r="4.5" fill="white" />
        </svg>`,
        iconAnchor: [15, 39],
        iconSize: [30, 40],
      });

      const marker = L.marker([start.lat, start.lng], {
        draggable: true,
        icon: pinIcon,
        keyboard: true,
      }).addTo(map);
      markerRef.current = marker;

      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onChangeRef.current({ lat, lng });
      });

      // Clicking the map is faster than dragging across a long distance.
      map.on("click", (event: Leaflet.LeafletMouseEvent) => {
        onChangeRef.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
    };

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (!hasSize()) {
              return;
            }
            if (mapRef.current) {
              mapRef.current.invalidateSize();
            } else {
              // First time the tab is opened: build it now, at the right size.
              void createMap();
            }
          });

    observer?.observe(container);
    void createMap();

    return () => {
      cancelled = true;
      observer?.disconnect();
      markerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Follow externally-driven moves (search result picked, "use my location").
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) {
      return;
    }

    const current = marker.getLatLng();
    // Skip the round trip when this update is the echo of a drag we just
    // reported, otherwise the map fights the user's own gesture.
    if (
      Math.abs(current.lat - value.lat) < 1e-9 &&
      Math.abs(current.lng - value.lng) < 1e-9
    ) {
      return;
    }

    marker.setLatLng([value.lat, value.lng]);
    // The picker's section can be revealed and searched in the same breath, and
    // a Leaflet map that still believes it is the old size recentres onto the
    // wrong pixel — re-measure before moving, not after.
    map.invalidateSize();
    // Animate rather than jump: a search result that teleports the map reads as
    // "nothing happened" when the new area looks much like the old one.
    map.flyTo([value.lat, value.lng], Math.max(map.getZoom(), 17), { duration: 0.6 });
  }, [value.lat, value.lng]);

  return <div className="h-full w-full" ref={containerRef} />;
}
