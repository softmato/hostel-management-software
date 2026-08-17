import { HostelCompare } from "@/components/hostel-compare";

/**
 * Compare as a tab. Sits on its empty state until hostels have been picked from
 * Search — which is what the empty state says, rather than leaving a tab that
 * looks broken.
 */
export default function BrowseCompareScreen() {
  return <HostelCompare browseHref="/(browse)/search" insideTabs />;
}
