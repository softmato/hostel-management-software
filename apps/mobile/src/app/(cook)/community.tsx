import { CommunityBoard } from "@/components/community-board";

/**
 * Community, as a tab in every signed-in role.
 *
 * The same board the public app has, and deliberately the same one: the feed is
 * platform-wide, so a warden, a cook and a resident are reading one conversation
 * rather than three role-shaped copies of it. `insideTabs` is the only
 * difference from the pushed `/community` route — a destination has no back
 * button and reserves the tab bar's height.
 */
export default function CookCommunityScreen() {
  return <CommunityBoard insideTabs />;
}
