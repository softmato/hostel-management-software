import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, Share, View } from "react-native";

import { CommentThread } from "@/components/community-comment-thread";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetRow } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { openAssetViewer } from "@/lib/asset-viewer";
import { readApiError } from "@/lib/api-contract";
import {
  addPostComment,
  type CommunityMedia,
  type CommunityPost,
  communityMediaUrl,
  deleteCommunityPost,
  getPostComments,
  type CommunityComment,
  reactToPost,
  reportPost,
  type ReactionType,
} from "@/lib/community-api";
import {
  avatarInitial,
  avatarTone,
  feedTime,
  MAX_COMMENT_BODY,
  MAX_REPORT_REASON,
  nextReaction,
  REACTIONS,
  reportReasonError,
  spaceBadge,
  usableAvatarUrl,
} from "@/lib/community";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";

/**
 * One post, ported from `apps/web/src/app/_components/community-post-card.tsx`.
 *
 * Same anatomy: avatar, author, space badge, relative time, announcement flag, an
 * options menu, the body, the media grid, then the reaction row with comment and
 * share, then the thread when opened.
 *
 * ## Comments are not fetched until the thread is opened
 *
 * The web's reasoning holds harder on a phone: a feed of twenty posts must not
 * fetch twenty comment trees nobody asked for. Fetched on first expand and kept
 * after that.
 *
 * ## All six reactions, as compact emoji
 *
 * The web renders four labelled pills and leaves `LOVE`/`SUPPORT` unoffered. Six
 * emoji at this size fit a 320dp row, and shipping four of six values the API
 * accepts is a narrowing that tends to become permanent.
 *
 * The total sits **outside** the row rather than inside the active pill.
 * `reactionCount` is one per user across every type, so printing it beside a
 * single emoji — as the web does — reads as "12 likes" when it means "12
 * reactions".
 *
 * ## Video is opened, not played inline
 *
 * `expo-video` is not a dependency, and a tile with a play triangle that does
 * nothing is worse than no triangle. Community media is `PUBLIC`, so the asset URL
 * opens in the OS player with no token — and the web does not autoplay either.
 */

export function CommunityPostCard({
  canPost,
  onChanged,
  post,
  /** True on the permalink screen: the thread starts open and "Open post" is gone. */
  standalone = false,
}: {
  canPost: boolean;
  onChanged: () => void;
  post: CommunityPost;
  standalone?: boolean;
}) {
  const { colors } = useAppTheme();

  const [expanded, setExpanded] = useState(standalone);
  const [comments, setComments] = useState<CommunityComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  /*
   * Reaction state is echoed locally so the pill responds to the tap. The parent's
   * refetch reconciles; without this the row is dead for a whole round trip on a
   * connection where that is half a second.
   */
  const [reaction, setReaction] = useState<ReactionType | null>(post.viewerReaction);
  const [reactionCount, setReactionCount] = useState(post.reactionCount);

  const requireAccount = useCallback(() => {
    toastInfo("Account needed", "Sign in to join the conversation.");
  }, []);

  const loadComments = useCallback(async () => {
    try {
      setComments(await getPostComments(post.id));
    } catch (caught) {
      toastError("Could not load comments", readApiError(caught));
    }
  }, [post.id]);

  const toggleThread = useCallback(() => {
    const opening = !expanded;

    setExpanded(opening);

    if (opening && comments === null) {
      void loadComments();
    }
  }, [comments, expanded, loadComments]);

  const react = useCallback(
    async (type: ReactionType) => {
      if (!canPost) {
        requireAccount();
        return;
      }

      const previous = { count: reactionCount, reaction };
      const next = nextReaction(reaction, type);

      setReaction(next.reaction);
      setReactionCount(reactionCount + next.countDelta);

      try {
        await reactToPost(post.id, type);
      } catch (caught) {
        setReaction(previous.reaction);
        setReactionCount(previous.count);
        toastError("Could not react", readApiError(caught));
      }
    },
    [canPost, post.id, reaction, reactionCount, requireAccount],
  );

  const comment = useCallback(async () => {
    const body = draft.trim();

    if (!body) {
      return;
    }

    try {
      await addPostComment(post.id, { body });
      setDraft("");
      await loadComments();
      onChanged();
    } catch (caught) {
      toastError("Could not comment", readApiError(caught));
    }
  }, [draft, loadComments, onChanged, post.id]);

  const share = useCallback(async () => {
    try {
      await Share.share({
        message: `${post.body.slice(0, 120)}\n\n${communityPostLink(post.id)}`,
      });
    } catch {
      // Dismissing the sheet is not an error worth reporting.
    }
  }, [post.body, post.id]);

  const remove = useCallback(() => {
    setMenuOpen(false);

    Alert.alert("Delete this post?", "It comes down for everyone.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void deleteCommunityPost(post.id)
            .then(() => {
              toastSuccess("Post deleted");
              onChanged();
            })
            .catch((caught: unknown) =>
              toastError("Could not delete", readApiError(caught)),
            );
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  }, [onChanged, post.id]);

  const avatarUrl = usableAvatarUrl(post.authorImage);
  const [tone, ink] = avatarTone(post.authorName);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start gap-3">
        {avatarUrl ? (
          <Image
            contentFit="cover"
            source={{ uri: avatarUrl }}
            style={{ borderRadius: 19, height: 38, width: 38 }}
          />
        ) : (
          <View
            className="items-center justify-center rounded-full"
            style={{ backgroundColor: tone, height: 38, width: 38 }}
          >
            <Text style={{ color: ink, fontSize: 15, fontWeight: "700" }}>
              {avatarInitial(post.authorName)}
            </Text>
          </View>
        )}

        <View className="flex-1">
          <Text numberOfLines={1} variant="label">
            {post.authorName}
          </Text>
          <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
            <Badge
              label={spaceBadge(post)}
              tone={post.spaceType === "PUBLIC" ? "neutral" : "success"}
            />
            <Text variant="caption">{feedTime(post.createdAt)}</Text>
            {post.isAnnouncement ? <Badge label="Announcement" tone="warning" /> : null}
          </View>
        </View>

        <Pressable
          accessibilityLabel="Post options"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => setMenuOpen(true)}
        >
          <Ionicons
            color={colors.mutedForeground}
            name="ellipsis-horizontal"
            size={18}
          />
        </Pressable>
      </View>

      <Text>{post.body}</Text>

      <MediaGrid media={post.media} />

      <View className="flex-row items-center gap-1 border-t border-border pt-3">
        {REACTIONS.map(({ emoji, label, type }) => {
          const active = reaction === type;

          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
              key={type}
              onPress={() => void react(type)}
              style={active ? { backgroundColor: colors.brandSoft } : undefined}
            >
              <Text style={{ fontSize: 17 }}>{emoji}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row items-center gap-4">
        {reactionCount > 0 ? (
          <Text variant="caption">
            {reactionCount === 1 ? "1 reaction" : `${reactionCount} reactions`}
          </Text>
        ) : null}

        <View className="flex-1" />

        <Pressable
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 active:opacity-70"
          onPress={toggleThread}
        >
          <Ionicons
            color={colors.mutedForeground}
            name="chatbubble-outline"
            size={15}
          />
          <Text variant="caption">{post.commentCount}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 active:opacity-70"
          onPress={() => void share()}
        >
          <Ionicons color={colors.mutedForeground} name="share-outline" size={15} />
          <Text variant="caption">Share</Text>
        </Pressable>
      </View>

      {expanded ? (
        <View className="gap-3 border-t border-border pt-3">
          {canPost ? (
            <View className="gap-2">
              <Input
                maxLength={MAX_COMMENT_BODY}
                multiline
                onChangeText={setDraft}
                placeholder="Add a comment…"
                style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
                value={draft}
              />
              <Pressable
                accessibilityRole="button"
                className="h-9 items-center justify-center self-end rounded-lg px-4 active:opacity-80"
                disabled={!draft.trim()}
                onPress={() => void comment()}
                style={{
                  backgroundColor: draft.trim() ? colors.primary : colors.muted,
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: draft.trim() ? colors.primaryForeground : colors.mutedForeground,
                  }}
                >
                  Comment
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text variant="caption">Sign in to comment.</Text>
          )}

          {comments === null ? (
            <Text variant="caption">Loading comments…</Text>
          ) : comments.length === 0 ? (
            <Text variant="caption">No comments yet. Say the first thing.</Text>
          ) : (
            <CommentThread
              canPost={canPost}
              comments={comments}
              onChanged={() => {
                void loadComments();
                onChanged();
              }}
              postId={post.id}
            />
          )}
        </View>
      ) : null}

      <Sheet onClose={() => setMenuOpen(false)} open={menuOpen} title="Post">
        {standalone ? null : (
          <SheetRow
            label="Open post"
            onPress={() => {
              setMenuOpen(false);
              router.push(`/community/${post.id}`);
            }}
            subtitle="Its own screen, with the thread open"
          />
        )}

        {post.isMine ? (
          <SheetRow label="Delete post" onPress={remove} subtitle="For everyone" />
        ) : (
          <SheetRow
            label="Report post"
            onPress={() => {
              setMenuOpen(false);

              if (!canPost) {
                requireAccount();
                return;
              }

              setReportOpen(true);
            }}
            subtitle="A moderator will take a look"
          />
        )}
      </Sheet>

      <ReportSheet
        onClose={() => setReportOpen(false)}
        open={reportOpen}
        postId={post.id}
      />
    </Card>
  );
}

/** The permalink a share points at — the web route, which the app also handles. */
function communityPostLink(postId: string) {
  return `https://softmato.com/community/${postId}`;
}

/**
 * One image fills the width; several tile in two columns with an odd last tile
 * spanning both — the web's arrangement, which stops a three-image post leaving a
 * hole.
 */
function MediaGrid({ media }: { media: CommunityMedia[] }) {
  const { colors } = useAppTheme();

  if (media.length === 0) {
    return null;
  }

  const single = media.length === 1;

  /*
   * Images go to the in-app viewer; a video still leaves for the OS, because the
   * viewer draws stills and a play button that opened a frozen frame would be
   * worse than the browser. The viewer's collection is therefore the **images
   * only** — passing every item would make the counter say "3 of 5" and then
   * skip two pages that cannot be drawn.
   */
  const images = media.filter((item) => item.kind !== "VIDEO");
  const imageItems = images.map((item) => ({
    url: communityMediaUrl(item.assetId, "ORIGINAL"),
  }));

  return (
    <View className="flex-row flex-wrap gap-1.5">
      {media.map((item, index) => {
        const spansBoth = !single && media.length % 2 === 1 && index === media.length - 1;
        const isVideo = item.kind === "VIDEO";

        return (
          <Pressable
            accessibilityLabel={isVideo ? "Play video" : "Open image"}
            accessibilityRole="imagebutton"
            className="overflow-hidden rounded-xl active:opacity-90"
            key={item.assetId}
            onPress={() => {
              if (isVideo) {
                // PUBLIC assets, so the OS can fetch this with no credential of ours.
                void Linking.openURL(communityMediaUrl(item.assetId, "ORIGINAL"));

                return;
              }

              openAssetViewer(
                imageItems,
                images.findIndex((image) => image.assetId === item.assetId),
              );
            }}
            style={{
              height: single ? 240 : spansBoth ? 150 : 120,
              width: single || spansBoth ? "100%" : "48.5%",
            }}
          >
            <Image
              contentFit="cover"
              source={{
                uri: communityMediaUrl(item.assetId, single ? "LARGE" : "MEDIUM"),
              }}
              style={{ backgroundColor: colors.muted, height: "100%", width: "100%" }}
            />

            {isVideo ? (
              <View
                className="absolute inset-0 items-center justify-center"
                pointerEvents="none"
              >
                <View
                  className="h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                >
                  <Ionicons color="#ffffff" name="play" size={22} />
                </View>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ReportSheet({
  onClose,
  open,
  postId,
}: {
  onClose: () => void;
  open: boolean;
  postId: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { colors } = useAppTheme();

  const submit = useCallback(async () => {
    const problem = reportReasonError(reason);

    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await reportPost(postId, reason.trim());
      toastSuccess("Reported", "A moderator will take a look.");
      setReason("");
      onClose();
    } catch (caught) {
      setError(readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [onClose, postId, reason]);

  return (
    <Sheet
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy }}
          className="h-12 items-center justify-center rounded-xl active:opacity-85"
          disabled={busy}
          onPress={() => void submit()}
          style={{ backgroundColor: colors.destructive }}
        >
          {/* White on the destructive fill in both themes — the palette has no
              `destructiveForeground` token, and `#0a8a4b`-style literals are what
              `button.tsx` falls back to for the same reason. */}
          <Text className="font-semibold" style={{ color: "#ffffff" }}>
            {busy ? "Reporting…" : "Report"}
          </Text>
        </Pressable>
      }
      onClose={onClose}
      open={open}
      title="Report this post"
    >
      <View className="gap-2 px-5 pt-3">
        <Text variant="muted">
          Tell a moderator what is wrong with it. Reports are not shown to the
          author.
        </Text>
        <Input
          error={error}
          maxLength={MAX_REPORT_REASON}
          multiline
          onChangeText={setReason}
          placeholder="Spam, abuse, something misleading…"
          style={{ height: 88, paddingTop: 12, textAlignVertical: "top" }}
          value={reason}
        />
      </View>
    </Sheet>
  );
}
