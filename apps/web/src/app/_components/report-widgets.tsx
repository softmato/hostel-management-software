"use client";

import type { ReactNode } from "react";

import { currency, EmptyState } from "@/app/_components/shared-ui";

export type CountMap = Record<string, number>;

/** Single headline figure with an optional caption underneath. */
export function StatTile({
  hint,
  label,
  tone = "default",
  value,
}: {
  hint?: ReactNode;
  label: string;
  tone?: "default" | "good" | "warn" | "bad";
  value: ReactNode;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-background p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1.5 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Horizontal bars for a `{ STATUS: count }` breakdown. */
export function Breakdown({
  emptyLabel = "No data yet.",
  map,
  total,
}: {
  emptyLabel?: string;
  map: CountMap;
  total?: number;
}) {
  const entries = Object.entries(map ?? {}).sort((left, right) => right[1] - left[1]);

  if (entries.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  const max = total ?? entries.reduce((sum, [, count]) => sum + count, 0) ?? 1;

  return (
    <dl className="grid gap-2.5">
      {entries.map(([label, count]) => (
        <div key={label}>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="truncate text-xs font-medium text-foreground">
              {label.replaceAll("_", " ")}
            </dt>
            <dd className="shrink-0 text-xs font-bold text-foreground">
              {count.toLocaleString()}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {max > 0 ? `${Math.round((count / max) * 100)}%` : "0%"}
              </span>
            </dd>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-role-admin"
              style={{ width: max > 0 ? `${Math.max((count / max) * 100, 2)}%` : "0%" }}
            />
          </div>
        </div>
      ))}
    </dl>
  );
}

export type MonthlyPoint = {
  collectionRate: number;
  due: number;
  month: string;
  outstanding: number;
  paid: number;
  residents: number;
};

function monthLabel(month: string) {
  const [year, index] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(index) - 1, 1));

  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleString("en", { month: "short", timeZone: "UTC" });
}

/**
 * Due-vs-collected columns per month, straight off the payment ledger. Bars are
 * scaled to the largest month so an empty ledger renders flat rather than broken.
 */
export function CollectionChart({ points }: { points: MonthlyPoint[] }) {
  const peak = Math.max(...points.map((point) => point.due), 1);

  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height: 160 }}>
        {points.map((point) => (
          <div className="flex flex-1 flex-col items-center gap-1" key={point.month}>
            <span className="text-[10px] font-semibold text-muted-foreground">
              {point.due > 0 ? `${point.collectionRate}%` : ""}
            </span>
            <div
              className="relative flex w-full items-end justify-center gap-0.5"
              style={{ height: 120 }}
              title={`${point.month} — due ${point.due}, collected ${point.paid}`}
            >
              <div
                className="w-1/2 rounded-t bg-muted"
                style={{ height: `${Math.max((point.due / peak) * 100, 1)}%` }}
              />
              <div
                className="w-1/2 rounded-t bg-role-admin"
                style={{ height: `${Math.max((point.paid / peak) * 100, 1)}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">
              {monthLabel(point.month)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted" /> Billed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-role-admin" /> Collected
        </span>
      </div>
    </div>
  );
}

/** Compact table used for the recent-payments ledger extract. */
export function DataTable({
  columns,
  emptyLabel,
  rows,
}: {
  columns: string[];
  emptyLabel: string;
  rows: ReactNode[][];
}) {
  if (rows.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                key={column}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="border-b border-border/60 last:border-0" key={index}>
              {row.map((cell, cellIndex) => (
                <td className="py-2.5 pr-3 text-foreground" key={cellIndex}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function money(value: number) {
  return currency(value);
}
