import { CommunityBoard } from "@/components/community-board";

/**
 * Community as a tab: a destination, so no back button, and the feed reserves the
 * tab bar's height instead of running underneath it.
 */
export default function BrowseCommunityScreen() {
  return <CommunityBoard insideTabs />;
}
