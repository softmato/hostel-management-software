import { useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { CommunityPostCard } from "@/components/community-post-card";
import { AppBar } from "@/components/ui/app-bar";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import {
  type CommunityPost,
  type CommunitySpaces,
  getCommunityPost,
  getCommunitySpaces,
} from "@/lib/community-api";

/**
 * One post on its own screen — the permalink a share link points at, and where a
 * community push notification lands.
 *
 * The web serves the same thing at `/community/<id>` by swapping the feed request
 * for a single-post one and passing `standalone` to the card. Here it is a route of
 * its own, because it is also a deep-link target: `lib/push-link.ts` maps the
 * server's `/community/<id>` onto it.
 *
 * `GET /community/[postId]` **404s for a post the reader may not see** — a
 * `HOSTEL_ONLY` post from another hostel is reported exactly like one that does not
 * exist, so the 404 cannot be used to confirm it is there (RULES.md §3). The error
 * copy therefore does not speculate about which of the two it is.
 */
export default function CommunityPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const post = useResource<CommunityPost>(
    useCallback(() => getCommunityPost(postId), [postId]),
    { topics: [REALTIME_TOPIC.COMMUNITY] },
  );

  /*
   * Only for `viewer.canPost` — the same question the feed asks. A signed-out
   * reader arriving from a shared link still sees the post and its thread; what
   * they cannot do is react, comment or vote.
   */
  const spaces = useResource<CommunitySpaces>(
    useCallback(() => getCommunitySpaces(), []),
  );

  const header = <AppBar showBack title="Post" />;

  if (post.loading) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  if (post.error || !post.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={post.error ?? "This post is not available."}
          onRetry={post.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      onRefresh={post.refresh}
      refreshing={post.refreshing}
      scroll
    >
      <View className="pt-1">
        <CommunityPostCard
          canPost={Boolean(spaces.data?.viewer.canPost)}
          onChanged={post.refresh}
          post={post.data}
          standalone
        />
      </View>
    </Screen>
  );
}
