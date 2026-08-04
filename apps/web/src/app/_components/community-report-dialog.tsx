"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * The report sheet. A fixed reason list rather than a free-text box, because a
 * reason drawn from a known set is something the triage step and a moderator
 * can both act on — "Scam" routes differently from "Spam or misleading", where
 * a paragraph of prose routes nowhere.
 *
 * Details stay optional and free-text: the list cannot cover everything, and
 * the person reporting usually knows something the list does not.
 */
const REASONS = [
  "Verbal abuse",
  "Scam",
  "Harassment",
  "Spam or misleading",
  "Something else",
] as const;

export function CommunityReportDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  /** Resolves when the report is filed; the dialog closes itself either way. */
  onSubmit: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  // The sheet only ever opens from a click, so there is nothing to render on
  // the server — and createPortal needs a real document. Portalled to the body
  // so it is never clipped by a card's overflow or stacking context.
  if (typeof document === "undefined") {
    return null;
  }

  async function handleSubmit() {
    if (!reason || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      // The details ride along with the reason — the API takes one string, and
      // a moderator reading the queue wants both in front of them.
      await onSubmit(details.trim() ? `${reason} — ${details.trim()}` : reason);
    } finally {
      setIsSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[3px]"
      onClick={onCancel}
      role="presentation"
    >
      <div
        aria-labelledby="report-dialog-title"
        aria-modal="true"
        className="w-[340px] max-w-full overflow-hidden rounded-2xl bg-surface-strong shadow-[0_24px_60px_rgba(0,0,0,0.28)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="px-5 pb-3 pt-5 text-center">
          <p className="text-base font-bold text-foreground" id="report-dialog-title">
            Report post
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Why are you reporting this?
          </p>
        </div>

        <div>
          {REASONS.map((option) => (
            <button
              className="flex w-full items-center justify-between border-t border-border px-5 py-3 text-left transition hover:bg-muted/60"
              key={option}
              onClick={() => setReason(option)}
              type="button"
            >
              <span className="text-sm text-foreground">{option}</span>
              <span
                className={cn(
                  "flex size-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] text-white",
                  reason === option
                    ? "border-brand-teal bg-brand-teal"
                    : "border-border bg-transparent",
                )}
              >
                {reason === option ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-border px-5 py-3.5">
          <textarea
            className="min-h-[50px] w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-[13px] text-foreground outline-none focus:border-brand-teal"
            maxLength={400}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Add details (optional)"
            value={details}
          />
        </div>

        <div className="flex border-t border-border">
          <button
            className="flex-1 border-r border-border py-3.5 text-sm text-foreground transition hover:bg-muted/60"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={cn(
              "flex-1 py-3.5 text-sm font-bold transition",
              reason
                ? "text-brand-teal hover:bg-brand-teal/5"
                : "cursor-not-allowed text-muted-foreground",
            )}
            disabled={!reason || isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
