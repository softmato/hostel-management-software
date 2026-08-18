import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { readApiError } from "@/lib/api-contract";
import {
  addPostComment,
  type CommunityComment,
  voteOnComment,
} from "@/lib/community-api";
import {
  avatarInitial,
  avatarTone,
  feedTime,
  hiddenCommentIds,
  MAX_COMMENT_BODY,
  nextVote,
  replyCounts,
} from "@/lib/community";
import { toastError, toastInfo } from "@/lib/toast";

/**
 * The comment tree, ported from the web's `CommentThread`.
 *
 * The server returns the tree **already flattened into display order** with a
 * `depth` on each row, capped at 5 — so this indents by `depth` and never rebuilds
 * the tree. Rebuilding or re-sorting it would cut replies away from what they
 * answer.
 *
 * ## Votes echo locally
 *
 * The arrow responds to the tap and the refetch behind it reconciles. Tapping the
 * arrow already chosen clears the vote, which is both the web's behaviour and the
 * server's (`value: 0` deletes the row). `lib/community.ts`'s `nextVote` owns the
 * arithmetic, including the flip that moves a score by two.
 *
 * ## Indentation is capped in pixels as well as in depth
 *
 * `depth` stops at 5 server-side, but 5 × 26dp is 130dp of a 320dp screen. The
 * step shrinks to 14dp here, so a deep argument still leaves the text readable —
 * the same intent as the web's cap, at a phone's width.
 */

const INDENT_STEP = 14;

export function CommentThread({
  canPost,
  comments,
  onChanged,
  postId,
}: {
  canPost: boolean;
  comments: CommunityComment[];
  onChanged: () => void;
  postId: string;
}) {
  const { colors } = useAppTheme();

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [localVotes, setLocalVotes] = useState<
    Record<string, { score: number; value: number }>
  >({});

  const hidden = useMemo(
    () => hiddenCommentIds(comments, collapsed),
    [collapsed, comments],
  );
  const replies = useMemo(() => replyCounts(comments), [comments]);

  const vote = useCallback(
    async (comment: CommunityComment, direction: 1 | -1) => {
      if (!canPost) {
        toastInfo("Account needed", "Sign in to vote on comments.");
        return;
      }

      const current = localVotes[comment.id]?.value ?? comment.viewerVote;
      const base = localVotes[comment.id]?.score ?? comment.score;
      const next = nextVote(current, base, direction);

      setLocalVotes((votes) => ({
        ...votes,
        [comment.id]: { score: next.score, value: next.value },
      }));

      try {
        await voteOnComment(postId, comment.id, next.value);
      } catch (caught) {
        setLocalVotes((votes) => ({
          ...votes,
          [comment.id]: { score: base, value: current },
        }));
        toastError("Could not vote", readApiError(caught));
      }
    },
    [canPost, localVotes, postId],
  );

  const submitReply = useCallback(
    async (parentId: string) => {
      const body = replyDraft.trim();

      if (!body) {
        return;
      }

      try {
        await addPostComment(postId, { body, parentId });
        setReplyDraft("");
        setReplyingTo(null);
        onChanged();
      } catch (caught) {
        toastError("Could not reply", readApiError(caught));
      }
    },
    [onChanged, postId, replyDraft],
  );

  return (
    <View className="gap-3">
      {comments
        .filter((comment) => !hidden.has(comment.id))
        .map((comment) => {
          const isCollapsed = collapsed.has(comment.id);
          const replyCount = replies.get(comment.id) ?? 0;
          const score = localVotes[comment.id]?.score ?? comment.score;
          const viewerVote = localVotes[comment.id]?.value ?? comment.viewerVote;
          const [tone, ink] = avatarTone(comment.authorName);

          return (
            <View
              className={comment.depth > 0 ? "border-l border-border pl-2.5" : ""}
              key={comment.id}
              style={{ marginLeft: comment.depth * INDENT_STEP }}
            >
              <View className="flex-row gap-2.5">
                <View
                  className="items-center justify-center rounded-full"
                  style={{ backgroundColor: tone, height: 28, width: 28 }}
                >
                  <Text style={{ color: ink, fontSize: 11, fontWeight: "700" }}>
                    {avatarInitial(comment.authorName)}
                  </Text>
                </View>

                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text variant="label">{comment.authorName}</Text>
                    <Text variant="caption">{feedTime(comment.createdAt)}</Text>
                  </View>

                  {isCollapsed ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setCollapsed((ids) => {
                          const next = new Set(ids);
                          next.delete(comment.id);
                          return next;
                        })
                      }
                    >
                      <Text variant="caption">
                        {replyCount === 1
                          ? "1 reply hidden — tap to expand"
                          : `${replyCount} replies hidden — tap to expand`}
                      </Text>
                    </Pressable>
                  ) : (
                    <>
                      <Text>{comment.body}</Text>

                      <View className="flex-row items-center gap-4">
                        <View className="flex-row items-center gap-1.5">
                          <Pressable
                            accessibilityLabel="Upvote"
                            accessibilityRole="button"
                            accessibilityState={{ selected: viewerVote === 1 }}
                            hitSlop={8}
                            onPress={() => void vote(comment, 1)}
                          >
                            <Ionicons
                              color={viewerVote === 1 ? colors.primary : colors.mutedForeground}
                              name="arrow-up"
                              size={15}
                            />
                          </Pressable>

                          <Text variant="caption">{score}</Text>

                          <Pressable
                            accessibilityLabel="Downvote"
                            accessibilityRole="button"
                            accessibilityState={{ selected: viewerVote === -1 }}
                            hitSlop={8}
                            onPress={() => void vote(comment, -1)}
                          >
                            <Ionicons
                              color={
                                viewerVote === -1 ? colors.destructive : colors.mutedForeground
                              }
                              name="arrow-down"
                              size={15}
                            />
                          </Pressable>
                        </View>

                        {canPost ? (
                          <Pressable
                            accessibilityRole="button"
                            hitSlop={6}
                            onPress={() => {
                              setReplyDraft("");
                              setReplyingTo((id) =>
                                id === comment.id ? null : comment.id,
                              );
                            }}
                          >
                            <Text variant="caption">Reply</Text>
                          </Pressable>
                        ) : null}

                        {replyCount > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            hitSlop={6}
                            onPress={() =>
                              setCollapsed((ids) => new Set(ids).add(comment.id))
                            }
                          >
                            <Text className="text-primary" variant="caption">
                              Collapse
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>

                      {replyingTo === comment.id ? (
                        <View className="mt-1 gap-2">
                          <Input
                            autoFocus
                            maxLength={MAX_COMMENT_BODY}
                            multiline
                            onChangeText={setReplyDraft}
                            placeholder="Write a reply…"
                            style={{
                              height: 60,
                              paddingTop: 10,
                              textAlignVertical: "top",
                            }}
                            value={replyDraft}
                          />
                          <Pressable
                            accessibilityRole="button"
                            className="h-8 items-center justify-center self-end rounded-lg px-3.5 active:opacity-80"
                            onPress={() => void submitReply(comment.id)}
                            style={{ backgroundColor: colors.primary }}
                          >
                            <Text
                              className="text-xs font-semibold"
                              style={{ color: colors.primaryForeground }}
                            >
                              Reply
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              </View>
            </View>
          );
        })}
    </View>
  );
}
