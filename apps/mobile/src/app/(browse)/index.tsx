import { PublicHome } from "@/components/public-home";

/**
 * The signed-in home. Identical body to `(public)/index`; the browse link points
 * at the sibling tab rather than at the public stack, so the tab bar survives it.
 */
export default function BrowseHomeScreen() {
  return <PublicHome browseHref="/(browse)/search" insideTabs />;
}
