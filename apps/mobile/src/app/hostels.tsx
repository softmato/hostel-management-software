import { HostelBrowser } from "@/components/hostel-browser";

/**
 * Browse, as a pushed screen with a back button.
 *
 * The `(browse)` group has Search as a tab, which is where someone shopping for
 * a hostel meets it. This is the same browser for everyone else: a resident,
 * admin or provider opening "Explore hostels" from their More tab, who must come
 * back to their own tabs afterwards rather than be dropped into another
 * navigator. Same component, so the two cannot drift.
 */
export default function HostelsScreen() {
  return <HostelBrowser compareHref="/compare" showBack />;
}
