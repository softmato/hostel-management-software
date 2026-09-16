"use client";

import type { ReactNode } from "react";

import { ApiRequestError } from "@/lib/browser-api";
import { cn } from "@/lib/utils";

/** The small pieces the checkout and the booking pages share. */

export const INPUT =
  "mt-2 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal text-foreground outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15";

export const PRIMARY =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-teal text-sm font-bold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-teal text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

export const rupees = (amount: number | null | undefined) => `Rs ${(amount ?? 0).toLocaleString("en-IN")}`;

const nepalTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kathmandu",
});

/** Every booking time is shown in Nepal time, whatever the reader's clock says. */
export const at = (iso: string | null | undefined) => (iso ? nepalTime.format(new Date(iso)) : "");

export function errorText(error: unknown) {
  if (error instanceof ApiRequestError) {
    const issues = (error.details as { issues?: Array<{ message: string }> } | undefined)?.issues;

    return issues?.[0]?.message ?? error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      {title ? <h2 className="mb-4 text-lg font-extrabold text-foreground">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "danger" | "neutral" }) {
  return (
    <p
      className={cn(
        "rounded-lg border p-4 text-sm",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-foreground",
      )}
    >
      {children}
    </p>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

export function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => (
          <div className="flex items-start justify-between gap-4" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-bold text-foreground">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
