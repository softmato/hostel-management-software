import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * The old per-hostel directions screen, now a door into the map.
 *
 * It drew one route on one map and could do nothing else — no pins for the
 * hostels around it, no search, no way to change from driving to walking. All of
 * that is `/map`, which takes the same slug and opens on the same hostel with
 * directions already running, so this route stays valid for anything that
 * already links to it rather than becoming a dead end.
 *
 * A redirect rather than a second map: two screens drawing routes is two places
 * for the profile toggle, the permission fallback and the dashed-line rule to
 * drift apart, and this codebase has paid that bill before.
 */
export default function DirectionsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  return <Redirect href={`/map?route=1&slug=${encodeURIComponent(slug ?? "")}`} />;
}
