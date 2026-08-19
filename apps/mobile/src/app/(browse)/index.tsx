import { PublicHome } from "@/components/public-home";

/**
 * Home. The one discovery home there is, signed in or out — see
 * `constants/roles.ts` for why the signed-out group is gone.
 */
export default function BrowseHomeScreen() {
  return <PublicHome browseHref="/(browse)/search" insideTabs />;
}
