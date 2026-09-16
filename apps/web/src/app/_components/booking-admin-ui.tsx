"use client";

import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { errorText } from "@/app/_components/booking-ui";
import { RoleButton } from "@/app/_components/portal-dashboard-ui";
import { EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources } from "@/lib/portal-query";
import { toast } from "@/stores/toast-store";

/** What the platform's and the hostel's booking screens share: rows, reasons, countdowns, actions. */

type Tone = ComponentProps<typeof RoleButton>["tone"];

export const FIELD =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand-teal";

/** A clock for countdowns, ticking once a minute. `0` until mounted, so render stays pure. */
export function useNow() {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  return now;
}

export function timeLeft(iso: string | null, now: number) {
  if (!iso || !now) return "";

  const ms = Date.parse(iso) - now;

  if (ms <= 0) return "overdue";

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);

  return hours ? `${hours} h ${minutes} min left` : `${minutes} min left`;
}

/** One POST/PUT/DELETE with a toast either way, then the named lists refetch. */
export function useAction(refresh: string[]) {
  const invalidate = useInvalidateResources();
  const [busy, setBusy] = useState<string | null>(null);
  const refreshKey = refresh.join("|");

  const run = useCallback(
    async <T,>(key: string, url: string, body: unknown, success: string, method = "POST") => {
      setBusy(key);

      try {
        const data = await browserApi<T>(url, { body: JSON.stringify(body ?? {}), method });

        toast.success({ title: success });
        invalidate(...refreshKey.split("|"));

        return data;
      } catch (error) {
        toast.error({ description: errorText(error), title: "Not done" });

        return null;
      } finally {
        setBusy(null);
      }
    },
    [invalidate, refreshKey],
  );

  return { busy, run };
}

/** A button that asks for a reason first. */
export function ReasonAction({
  busy,
  label,
  onSubmit,
  placeholder,
  required = true,
  tone,
}: {
  busy: boolean;
  label: string;
  onSubmit: (reason: string) => void;
  placeholder: string;
  required?: boolean;
  tone?: Tone;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <RoleButton onClick={() => setOpen(true)} tone={tone} variant="outline">
        {label}
      </RoleButton>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      <input
        autoFocus
        className={FIELD}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder={placeholder}
        value={reason}
      />
      <div className="flex gap-2">
        <RoleButton disabled={busy || (required && !reason.trim())} onClick={() => onSubmit(reason.trim())} tone={tone}>
          {label}
        </RoleButton>
        <RoleButton onClick={() => setOpen(false)} tone={tone} variant="outline">
          Close
        </RoleButton>
      </div>
    </div>
  );
}

export function Row({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1 text-sm">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2 lg:max-w-md lg:justify-end">{actions}</div> : null}
    </li>
  );
}

export function List<T>({
  empty,
  items,
  render,
  state,
}: {
  empty: string;
  items: T[] | undefined;
  render: (item: T) => ReactNode;
  state: string;
}) {
  if (state === "loading" || state === "idle") return <LoadingRows />;
  if (!items || items.length === 0) return <EmptyState label={empty} />;

  return <ul className="divide-y divide-border">{items.map(render)}</ul>;
}
