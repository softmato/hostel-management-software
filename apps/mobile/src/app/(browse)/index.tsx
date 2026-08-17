import { PublicHome } from "@/components/public-home";

/**
 * The signed-in home. Identical body to `(public)/index`; the links point at
 * sibling tabs rather than at the public stack, so the tab bar survives them.
 */
export default function BrowseHomeScreen() {
  return (
    <PublicHome
      browseHref="/(browse)/search"
      compareHref="/(browse)/compare"
      insideTabs
    />
  );
}
