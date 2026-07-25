"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function currency(value: number) {
  return new Intl.NumberFormat("en-NP", {
    currency: "NPR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

export function StatusBadge({ children }: { children: string }) {
  const tone =
    children.includes("PAID") ||
    children.includes("ACTIVE") ||
    children.includes("APPROVED")
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : children.includes("PENDING")
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : children.includes("REJECTED") || children.includes("OVERDUE")
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-border bg-muted text-muted-foreground";

  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", tone)}>
      {children.replaceAll("_", " ")}
    </span>
  );
}

export function Panel({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface p-3.5 shadow-sm",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-3 font-heading text-[13.5px] font-bold text-foreground">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function Input({
  defaultValue,
  label,
  min,
  name,
  required,
  step,
  type = "text",
}: {
  defaultValue?: string | number;
  label: string;
  min?: string;
  name: string;
  required?: boolean;
  step?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-foreground">
      {label}
      <input
        className="h-11 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus:border-role-admin"
        defaultValue={defaultValue}
        min={min}
        name={name}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}

export function Select({
  children,
  defaultValue,
  label,
  name,
  required,
}: {
  children: ReactNode;
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-foreground">
      {label}
      <select
        className="h-11 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus:border-role-admin"
        defaultValue={defaultValue}
        name={name}
        required={required}
      >
        {children}
      </select>
    </label>
  );
}

export function TextArea({
  defaultValue,
  label,
  name,
}: {
  defaultValue?: string;
  label: string;
  name: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-foreground">
      {label}
      <textarea
        className="min-h-24 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-role-admin"
        defaultValue={defaultValue}
        name={name}
      />
    </label>
  );
}

export function LoadingRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="h-12 animate-pulse rounded-md bg-muted" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground"
      onClick={onClick}
      type="button"
    >
      <RefreshCw className="size-4" />
      Refresh
    </button>
  );
}
