"use client";

import { ExternalLink, GraduationCap } from "lucide-react";
import { useCallback, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { SectionCard } from "./portal-dashboard-ui";

/**
 * Study-partner entry point, shown only to STUDENT residents (PHASES.md §5.1).
 *
 * The click is recorded server-side and the server answers with where to go, so
 * the destination and the SSO handshake stay out of the client bundle.
 */
export function ResidentQuestionCallCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleClick = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      const result = await browserApi<{ redirectUrl: string }>(
        "/api/v1/resident/questioncall/click",
        { body: JSON.stringify({ deviceType: "web" }), method: "POST" },
      );

      // noopener/noreferrer: the partner tab must not get a handle on ours.
      window.open(result.redirectUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open QuestionCall.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <SectionCard title="Study with QuestionCall">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
            <GraduationCap aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Ask questions, get answers
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              QuestionCall connects students with tutors. Your name and hostel are shared
              so you can sign in without filling another form.
            </p>
          </div>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-60"
          disabled={busy}
          onClick={handleClick}
          type="button"
        >
          {busy ? "Opening…" : "Open QuestionCall"}
          <ExternalLink aria-hidden="true" className="size-4" />
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}
