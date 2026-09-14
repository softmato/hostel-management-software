"use client";

import { Bell, Send, Siren } from "lucide-react";
import { memo, useCallback, useState, type FormEvent } from "react";

import {
  PortalPageHeader,
  RoleButton,
  SectionCard,
} from "@/app/_components/portal-dashboard-ui";
import { EmptyState, Input, LoadingRows, Select, TextArea } from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";

type Urgency = "NORMAL" | "URGENT";

type PushRecord = {
  audience: string;
  body: string;
  devices: number;
  id: string;
  recipients: number;
  sentAt: string;
  title: string;
  urgency: Urgency;
};

const ENDPOINT = "/api/v1/platform/push";

const AUDIENCE_LABEL: Record<string, string> = {
  EVERYONE: "Everyone",
  GUARDIANS: "Guardians",
  HOSTEL_STAFF: "Hostel owners & staff",
  RESIDENTS: "Residents",
};

function shortDateTime(value: string) {
  return new Date(value).toLocaleString("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

/**
 * Superadmin push: a heading, a message and an urgency, straight to every
 * phone and browser of the chosen audience. Urgent rides the urgent Android
 * channel and skips quiet hours — the same rule an SOS follows.
 */
export const PlatformPushPageContent = memo(function PlatformPushPageContent() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("NORMAL");
  const [audience, setAudience] = useState("EVERYONE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const history = usePortalResource<{ pushes: PushRecord[] }>(ENDPOINT, {
    errorMessage: "Could not load sent push notifications.",
  });
  const pushes = history.data?.pushes ?? [];

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setMessage("");

      try {
        const result = await browserApi<{ push: PushRecord }>(ENDPOINT, {
          body: JSON.stringify({ audience, body, title, urgency }),
          method: "POST",
        });

        setMessage(
          `Sent to ${result.push.recipients} account(s) · ${result.push.devices} device(s) took it.`,
        );
        setTitle("");
        setBody("");
        setUrgency("NORMAL");
        await history.refreshAsync();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not send the push.");
      } finally {
        setBusy(false);
      }
    },
    [audience, body, history, title, urgency],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-5">
      <PortalPageHeader
        description="Goes to the app on phones and to browsers with notifications on."
        title="Push Notification"
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard title="Compose">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <Input
              label="Heading"
              name="title"
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
            <TextArea
              label="Content"
              name="body"
              onChange={(event) => setBody(event.target.value)}
              value={body}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 text-sm font-semibold text-foreground">
                Urgency
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1">
                  {(["NORMAL", "URGENT"] as const).map((value) => (
                    <button
                      aria-pressed={urgency === value}
                      className={cn(
                        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
                        urgency === value
                          ? value === "URGENT"
                            ? "bg-destructive text-white shadow-sm"
                            : "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      key={value}
                      onClick={() => setUrgency(value)}
                      type="button"
                    >
                      {value === "URGENT" ? (
                        <Siren aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Bell aria-hidden="true" className="size-3.5" />
                      )}
                      {value === "URGENT" ? "Urgent" : "Normal"}
                    </button>
                  ))}
                </div>
              </div>

              <Select
                label="Send to"
                name="audience"
                onChange={(event) => setAudience(event.target.value)}
                value={audience}
              >
                {Object.entries(AUDIENCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {message}
              </p>
              <RoleButton
                className="h-9 px-4"
                disabled={busy || title.trim().length < 2 || body.trim().length < 2}
                type="submit"
              >
                <Send aria-hidden="true" className="size-4" />
                {busy ? "Sending…" : "Send push"}
              </RoleButton>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Preview">
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl text-white",
                  urgency === "URGENT" ? "bg-destructive" : "bg-brand-teal",
                )}
              >
                {urgency === "URGENT" ? (
                  <Siren aria-hidden="true" className="size-4" />
                ) : (
                  <Bell aria-hidden="true" className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {title || "Heading"}
                </p>
                <p className="mt-0.5 line-clamp-3 text-[12.5px] text-muted-foreground">
                  {body || "Content"}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Sent">
        {history.state === "loading" ? <LoadingRows /> : null}
        {history.state !== "loading" && pushes.length === 0 ? (
          <EmptyState label="No push notifications sent yet." />
        ) : null}
        <div className="divide-y divide-border">
          {pushes.map((push) => (
            <div className="flex flex-wrap items-start justify-between gap-3 py-3" key={push.id}>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{push.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">
                  {push.body}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {shortDateTime(push.sentAt)} · {AUDIENCE_LABEL[push.audience] ?? push.audience}{" "}
                  · {push.recipients} account(s) · {push.devices} device(s)
                </p>
              </div>
              {push.urgency === "URGENT" ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                  Urgent
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
});
