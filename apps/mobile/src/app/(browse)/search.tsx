import { HostelBrowser } from "@/components/hostel-browser";

/** Browse as a tab: a destination, so no back button. */
export default function BrowseSearchScreen() {
  return <HostelBrowser compareHref="/(browse)/compare" insideTabs />;
}
