"use client";

import { Megaphone, Users } from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  EmptyState,
  LoadingRows,
  Panel,
  StatusBadge,
  TextArea,
} from "@/app/_components/shared-ui";
import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { Message, PageHeader, field } from "./daily-operations-shared";

const COMMUNITY_ENDPOINT = "/api/v1/hostel-admin/community";

type ModeratedPost = {
  authorName: string;
  body: string;
  commentCount: number;
  createdAt?: string;
  hiddenReason?: string;
  id: string;
  isAnnouncement: boolean;
  isAnonymous: boolean;
  reactionCount: number;
  reportCount?: number;
  status: "VISIBLE" | "HIDDEN";
};

export const HostelAdminCommunityPageContent = memo(
  function HostelAdminCommunityPageContent() {
    const [actionMessage, setActionMessage] = useState("");
    const invalidate = useInvalidateResources();
    const resource = usePortalResource<{
      posts: ModeratedPost[];
      summary: { hidden: number; reported: number; total: number };
    }>(COMMUNITY_ENDPOINT, { errorMessage: "Could not load community posts." });

    const posts = useMemo(() => resource.data?.posts ?? [], [resource.data]);
    const summary = resource.data?.summary;

    const announce = useCallback(
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);

        try {
          await browserApi(COMMUNITY_ENDPOINT, {
            body: JSON.stringify({ body: field(form, "body") }),
            method: "POST",
          });
          formElement.reset();
          setActionMessage("Announcement posted.");
          invalidate(COMMUNITY_ENDPOINT);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not post announcement.",
          );
        }
      },
      [invalidate],
    );

    const setHidden = useCallback(
      async (postId: string, hide: boolean) => {
        const reason = window
          .prompt(hide ? "Why are you hiding this post?" : "Why restore it?")
          ?.trim();

        if (!reason) {
          return;
        }

        try {
          await browserApi(`${COMMUNITY_ENDPOINT}/${postId}/hide`, {
            body: JSON.stringify({ reason }),
            method: hide ? "PATCH" : "DELETE",
          });
          setActionMessage(hide ? "Post hidden." : "Post restored.");
          invalidate(COMMUNITY_ENDPOINT);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not moderate the post.",
          );
        }
      },
      [invalidate],
    );

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Moderate the resident feed for your hostel and post official announcements."
          icon={Users}
          title="Community"
        />
        <Message value={actionMessage || resource.message} />

        {summary ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["Posts", summary.total],
              ["Reported", summary.reported],
              ["Hidden", summary.hidden],
            ] as Array<[string, number]>).map(([label, value]) => (
              <div className="rounded-lg border border-border bg-surface p-4" key={label}>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-3xl font-extrabold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="Posts">
            {resource.state === "loading" ? <LoadingRows /> : null}
            {resource.state === "ready" && posts.length === 0 ? (
              <EmptyState label="No community posts yet." />
            ) : null}
            <div className="space-y-3">
              {posts.map((post) => (
                <div className="rounded-lg border border-border p-4" key={post.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {post.authorName}
                        {post.isAnonymous ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (posted anonymously)
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                        {post.body}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge>{post.status}</StatusBadge>
                      {post.reportCount ? (
                        <StatusBadge>{`${post.reportCount} REPORTS`}</StatusBadge>
                      ) : null}
                      {post.isAnnouncement ? (
                        <StatusBadge>ANNOUNCEMENT</StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  {post.hiddenReason ? (
                    <p className="mt-3 rounded-md bg-muted p-2 text-xs text-foreground">
                      Hidden: {post.hiddenReason}
                    </p>
                  ) : null}
                  <button
                    className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground"
                    onClick={() => void setHidden(post.id, post.status === "VISIBLE")}
                    type="button"
                  >
                    {post.status === "VISIBLE" ? "Hide post" : "Restore post"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Post an Announcement">
            <BusyForm className="grid gap-3" onSubmit={announce}>
              <TextArea label="Announcement" name="body" />
              <SubmitButton className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-role-admin text-sm font-semibold text-white">
                <Megaphone className="size-4" />
                Publish
              </SubmitButton>
            </BusyForm>
          </Panel>
        </div>
      </div>
    );
  },
);
