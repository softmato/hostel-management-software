import { HostelCompare } from "@/components/hostel-compare";

/**
 * Compare, on the root stack: it is reachable from the signed-out public stack,
 * from a resident's More tab and from the browse tabs, so it cannot live inside
 * any one of them.
 */
export default function CompareScreen() {
  return <HostelCompare browseHref="/(public)/hostels" showBack />;
}
