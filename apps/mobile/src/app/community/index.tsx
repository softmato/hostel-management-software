import { CommunityBoard } from "@/components/community-board";

/**
 * Community, pushed — from a role's More menu or a shared post link — so it keeps
 * its back button. See `components/community-board.tsx` for why the feed itself
 * lives in a component.
 */
export default function CommunityScreen() {
  return <CommunityBoard showBack />;
}
