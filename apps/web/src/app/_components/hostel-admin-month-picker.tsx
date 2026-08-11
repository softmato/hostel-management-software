"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { memo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { monthLabel } from "@/lib/format-month";
import { cn } from "@/lib/utils";

export type PeriodRow = {
  collected: number;
  due: number;
  needsAttention: number;
  paid: number;
  period: string;
  total: number;
};

/**
 * The month the payments matrix is showing.
 *
 * Replaces `<input type="month">`, which was wrong here in three ways: it let
 * the owner walk back to months before the hostel existed and get an empty
 * table with no explanation, it emitted half-typed values that each cost a 422
 * (`2026-0`), and it could not answer the question the control is actually used
 * for — *which* month still needs work. A list of real months, each carrying its
 * own count of unfinished invoices, answers that at a glance.
 *
 * The list is the floor. There is no validation to bypass because a month before
 * the hostel was approved is simply not offered, which is also why there is no
 * error message to write.
 */
export const MonthPicker = memo(function MonthPicker({
  months,
  onChange,
  value,
}: {
  months: PeriodRow[];
  onChange: (period: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = months.find((month) => month.period === value) ?? null;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Choose month"
          className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/50"
          type="button"
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          {monthLabel(value)}
          {selected && selected.needsAttention > 0 ? (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-800 dark:text-amber-300">
              {selected.needsAttention}
            </span>
          ) : null}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-1.5">
        <p className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Month
        </p>
        <div className="max-h-72 overflow-y-auto">
          {months.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">
              No months to show yet.
            </p>
          ) : null}
          {months.map((month) => {
            const isSelected = month.period === value;

            return (
              <button
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[13px] transition",
                  isSelected
                    ? "bg-role-admin/10 font-bold text-foreground"
                    : "font-medium text-muted-foreground hover:bg-muted",
                )}
                key={month.period}
                onClick={() => {
                  onChange(month.period);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  {isSelected ? (
                    <Check className="size-3.5 text-role-admin" />
                  ) : (
                    <span className="size-3.5" />
                  )}
                  {monthLabel(month.period)}
                </span>

                {/* The badge counts invoices still wanting a human — unpaid,
                    overdue, or carrying an unreviewed claim. A month with none
                    gets no badge at all rather than a grey zero, so the eye goes
                    straight to the months with work left in them. */}
                {month.needsAttention > 0 ? (
                  <span
                    className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-800 dark:text-amber-300"
                    title={`${month.needsAttention} unpaid, overdue or awaiting review`}
                  >
                    {month.needsAttention}
                  </span>
                ) : month.total > 0 ? (
                  <Check className="size-3.5 text-emerald-600" />
                ) : (
                  <span className="text-[10.5px] text-muted-foreground">—</span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
});
