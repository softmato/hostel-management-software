import { PublicHome } from "@/components/public-home";

/**
 * The signed-out home. Same body as the `(browse)` Home tab — see
 * `components/public-home.tsx` for why the two groups exist.
 */
export default function PublicHomeScreen() {
  return <PublicHome browseHref="/(public)/hostels" />;
}
