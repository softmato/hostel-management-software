"use client";

import { AlertTriangle, Bell, Megaphone, Send } from "lucide-react";
import { memo, useCallback, useEffect, useState, type FormEvent } from "react";

import { EmptyState, Input, Select, TextArea } from "@/app/_components/shared-ui";
import {
  EmptyInline,
  PortalPageHeader,
  RoleButton,
  SectionCard,
  SoftBadge,
} from "@/app/_components/portal-dashboard-ui";
import { browserApi } from "@/lib/browser-api";

import { field, optionalField, type LoadState, type Notice } from "./hostel-admin-shared";

const CATEGORIES = ["GENERAL", "URGENT", "EVENT", "RULE", "MAINTENANCE", "PAYMENT", "FOOD"];

export const HostelAdminNoticesPage = memo(function HostelAdminNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await browserApi<{ notices: Notice[] }>(
        "/api/v1/hostel-admin/notices",
      );

      setNotices(data.notices);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load notices.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  const handleCreateNotice = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        await browserApi("/api/v1/hostel-admin/notices", {
          body: JSON.stringify({
            category: field(form, "category"),
            content: field(form, "content"),
            expiresAt: optionalField(form, "expiresAt"),
            isUrgent: form.get("isUrgent") === "on",
            title: field(form, "title"),
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setMessage("Notice published — residents notified.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not publish notice.");
      }
    },
    [load],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-5">
      <PortalPageHeader
        breadcrumb={[{ href: "/hostel-admin", label: "Home" }, "Notices"]}
        description="Publish announcements — residents are emailed and notified in-app."
        title="Notices"
      />
      {message ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-foreground">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Published Notices">
          {state === "loading" ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  className="h-20 animate-pulse rounded-xl border border-border/60 bg-muted/30"
                  key={index}
                />
              ))}
            </div>
          ) : null}
          {state === "error" ? <EmptyState label="Notices could not be loaded." /> : null}
          {state === "ready" && notices.length === 0 ? (
            <EmptyInline label="No notices published yet." />
          ) : null}
          <div className="space-y-2.5">
            {notices.map((notice) => (
              <div
                className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/15 p-3"
                key={notice.id}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                    notice.isUrgent
                      ? "bg-rose-50 text-rose-600"
                      : "bg-role-admin-soft text-role-admin"
                  }`}
                >
                  {notice.isUrgent ? (
                    <AlertTriangle className="size-[17px]" />
                  ) : (
                    <Megaphone className="size-[17px]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-bold text-foreground">{notice.title}</p>
                    {notice.isUrgent ? <SoftBadge tone="rose">Urgent</SoftBadge> : null}
                    <SoftBadge tone="slate">{notice.category}</SoftBadge>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {notice.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Create Notice">
          <form className="grid gap-3" onSubmit={handleCreateNotice}>
            <Input label="Title" name="title" required />
            <Select label="Category" name="category" required>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
            <TextArea label="Content" name="content" />
            <Input label="Expires at" name="expiresAt" type="date" />
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
              <input className="accent-role-admin" name="isUrgent" type="checkbox" />
              <span className="inline-flex items-center gap-1">
                <Bell className="size-3.5 text-rose-500" /> Mark as urgent
              </span>
            </label>
            <RoleButton className="w-full" tone="admin" type="submit">
              <Send className="size-3.5" />
              Publish Notice
            </RoleButton>
          </form>
        </SectionCard>
      </div>
    </div>
  );
});
