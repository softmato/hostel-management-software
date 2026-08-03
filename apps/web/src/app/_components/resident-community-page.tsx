"use client";

import { Megaphone, Send, Users } from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  EmptyState,
  LoadingRows,
  Panel,
  Select,
  StatusBadge,
  TextArea,
} from "@/app/_components/shared-ui";
import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { useConfirm } from "@/app/_components/confirm-dialog";
import { FileUploaderView, useUploader } from "@/components/uploads";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";
import { Message, ResidentHeader, field } from "./resident-shared";

const COMMUNITY_ENDPOINT = "/api/v1/resident/community";

type CommunityPost = {
  authorName: string;
  body: string;
  commentCount: number;
  createdAt?: string;
  id: string;
  isAnnouncement: boolean;
  isAnonymous: boolean;
  isMine: boolean;
  reactionCount: number;
  viewerReaction: string | null;
  visibility: "PUBLIC" | "HOSTEL_ONLY";
};

type CommunityComment = {
  authorName: string;
  body: string;
  id: string;
};

const REACTIONS: Array<[string, string]> = [
  ["LIKE", "👍"],
  ["LOVE", "❤️"],
  ["LAUGH", "😄"],
  ["SUPPORT", "🤝"],
  ["SAD", "😢"],
  ["ANGRY", "😠"],
];

export const ResidentCommunityPageContent = memo(function ResidentCommunityPageContent() {
  const [actionMessage, setActionMessage] = useState("");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const media = useUploader({
    accessLevel: "PUBLIC",
    kind: "image",
    label: "Photo",
    maxFiles: 6,
    optimizeImage: true,
  });
  const { clear: clearMedia, files: mediaFiles } = media;
  const invalidate = useInvalidateResources();
  const { confirm, confirmDialog } = useConfirm();
  const feed = usePortalResource<{ posts: CommunityPost[] }>(COMMUNITY_ENDPOINT, {
    errorMessage: "Could not load the community feed.",
  });

  const posts = useMemo(() => feed.data?.posts ?? [], [feed.data]);

  const publish = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

      try {
        await browserApi(COMMUNITY_ENDPOINT, {
          body: JSON.stringify({
            body: field(form, "body"),
            isAnonymous: form.get("isAnonymous") === "on",
            mediaAssetIds: mediaFiles
              .map((file) => file.assetId)
              .filter((assetId): assetId is string => Boolean(assetId)),
            visibility: field(form, "visibility"),
          }),
          method: "POST",
        });
        formElement.reset();
        clearMedia();
        setActionMessage("Posted.");
        invalidate(COMMUNITY_ENDPOINT);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not post.");
      }
    },
    [clearMedia, invalidate, mediaFiles],
  );

  const react = useCallback(
    async (postId: string, type: string) => {
      try {
        await browserApi(`${COMMUNITY_ENDPOINT}/${postId}/reactions`, {
          body: JSON.stringify({ type }),
          method: "POST",
        });
        invalidate(COMMUNITY_ENDPOINT);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not react.");
      }
    },
    [invalidate],
  );

  const openComments = useCallback(
    async (postId: string) => {
      if (openPostId === postId) {
        setOpenPostId(null);

        return;
      }

      setOpenPostId(postId);

      try {
        const data = await browserApi<{ comments: CommunityComment[] }>(
          `${COMMUNITY_ENDPOINT}/${postId}/comments`,
        );

        setComments(data.comments);
      } catch {
        setComments([]);
      }
    },
    [openPostId],
  );

  const addComment = useCallback(
    async (event: FormEvent<HTMLFormElement>, postId: string) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

      try {
        await browserApi(`${COMMUNITY_ENDPOINT}/${postId}/comments`, {
          body: JSON.stringify({
            body: field(form, "body"),
            isAnonymous: form.get("isAnonymous") === "on",
          }),
          method: "POST",
        });
        formElement.reset();

        const data = await browserApi<{ comments: CommunityComment[] }>(
          `${COMMUNITY_ENDPOINT}/${postId}/comments`,
        );

        setComments(data.comments);
        invalidate(COMMUNITY_ENDPOINT);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not comment.");
      }
    },
    [invalidate],
  );

  const report = useCallback(async (postId: string) => {
    const reason = window.prompt("What is wrong with this post?")?.trim();

    if (!reason) {
      return;
    }

    try {
      await browserApi(`${COMMUNITY_ENDPOINT}/${postId}/report`, {
        body: JSON.stringify({ reason }),
        method: "POST",
      });
      setActionMessage("Reported. A hostel admin will review it.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not report.");
    }
  }, []);

  const removeOwn = useCallback(
    async (postId: string) => {
      const confirmed = await confirm({
        actionLabel: "Delete post",
        description:
          "Your post and its comments come down for everyone in your hostel. This cannot be undone.",
        title: "Delete your post?",
        tone: "destructive",
      });

      if (!confirmed) {
        return;
      }

      try {
        await browserApi(`${COMMUNITY_ENDPOINT}/${postId}`, { method: "DELETE" });
        setActionMessage("Post deleted.");
        invalidate(COMMUNITY_ENDPOINT);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not delete.");
      }
    },
    [confirm, invalidate],
  );

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      {confirmDialog}
      <ResidentHeader
        description="Talk to the people you actually live with."
        icon={Users}
        title="Community"
      />
      <Message value={actionMessage || feed.message} />

      <Panel title="Share something">
        <BusyForm className="grid gap-3" onSubmit={publish}>
          <TextArea label="What's happening?" name="body" />
          <Select label="Visible to" name="visibility" required>
            <option value="HOSTEL_ONLY">My hostel only</option>
            <option value="PUBLIC">Anyone on HostelHub</option>
          </Select>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-foreground">
              Photos <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <FileUploaderView label="Add a photo" tone="resident" uploader={media} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input name="isAnonymous" type="checkbox" />
            Post anonymously
          </label>
          <SubmitButton className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-role-resident text-sm font-semibold text-white">
            <Send className="size-4" />
            Post
          </SubmitButton>
        </BusyForm>
      </Panel>

      <Panel title="Feed">
        {feed.state === "loading" ? <LoadingRows /> : null}
        {feed.state === "ready" && posts.length === 0 ? (
          <EmptyState label="Nothing posted yet. Be the first." />
        ) : null}
        <div className="space-y-4">
          {posts.map((post) => (
            <article className="rounded-lg border border-border p-4" key={post.id}>
              <div className="flex flex-wrap items-center gap-2">
                {post.isAnnouncement ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-role-admin/10 px-2 py-0.5 text-[10px] font-bold text-role-admin">
                    <Megaphone className="size-3" />
                    Hostel announcement
                  </span>
                ) : null}
                <span className="text-sm font-semibold text-foreground">
                  {post.authorName}
                </span>
                {post.visibility === "PUBLIC" ? <StatusBadge>PUBLIC</StatusBadge> : null}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ""}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-line text-sm text-foreground">
                {post.body}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {REACTIONS.map(([type, emoji]) => (
                  <button
                    aria-label={type}
                    className={cn(
                      "rounded-full border px-2 py-1 text-sm",
                      post.viewerReaction === type
                        ? "border-role-resident bg-role-resident/10"
                        : "border-border",
                    )}
                    key={type}
                    onClick={() => void react(post.id, type)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
                <span className="ml-1 text-xs text-muted-foreground">
                  {post.reactionCount}
                </span>
                <button
                  className="ml-auto text-xs font-semibold text-foreground underline"
                  onClick={() => void openComments(post.id)}
                  type="button"
                >
                  {post.commentCount} comments
                </button>
                {post.isMine ? (
                  <button
                    className="text-xs font-semibold text-destructive underline"
                    onClick={() => void removeOwn(post.id)}
                    type="button"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    className="text-xs font-semibold text-muted-foreground underline"
                    onClick={() => void report(post.id)}
                    type="button"
                  >
                    Report
                  </button>
                )}
              </div>

              {openPostId === post.id ? (
                <div className="mt-4 space-y-3 border-t border-border pt-3">
                  {comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No comments yet.</p>
                  ) : null}
                  {comments.map((comment) => (
                    <div key={comment.id}>
                      <p className="text-xs font-semibold text-foreground">
                        {comment.authorName}
                      </p>
                      <p className="text-xs text-muted-foreground">{comment.body}</p>
                    </div>
                  ))}
                  <BusyForm
                    className="grid gap-2"
                    onSubmit={(event) => void addComment(event, post.id)}
                  >
                    <TextArea label="Add a comment" name="body" />
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input name="isAnonymous" type="checkbox" />
                      Comment anonymously
                    </label>
                    <SubmitButton className="h-9 rounded-md bg-role-resident text-xs font-semibold text-white">
                      Comment
                    </SubmitButton>
                  </BusyForm>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
});
