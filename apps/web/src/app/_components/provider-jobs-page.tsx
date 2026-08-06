"use client";

import {
  Briefcase,
  CalendarClock,
  Loader2,
  MapPin,
  Phone,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PublicShell } from "@/app/_components/shared";
import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";

/**
 * The service provider's job feed — their only screen on the website.
 *
 * Providers get no portal by design: they are a public account with an approved
 * provider record, so this lives on the public site behind the same header,
 * which swaps the hostel-shopping tabs for a "Jobs" one once they are approved.
 * Every card here is a maintenance request a hostel admin assigned to them.
 */

type ProviderJob = {
  category: string;
  createdAt: string | null;
  description: string;
  hostelArea: string;
  hostelCity: string;
  hostelName: string;
  hostelPhone: string;
  id: string;
  location: string;
  priority: string;
  scheduledFor: string | null;
  status: string;
  title: string;
};

/** Open work first — a completed job is a record, not a task. */
const OPEN_STATUSES = new Set(["PENDING", "CONTACTED", "SCHEDULED"]);

const STATUS_TONES: Record<string, string> = {
  CANCELLED: "bg-muted text-muted-foreground",
  COMPLETED: "bg-brand-teal/10 text-brand-teal",
  CONTACTED: "bg-amber-500/10 text-amber-600",
  PENDING: "bg-sky-500/10 text-sky-600",
  SCHEDULED: "bg-violet-500/10 text-violet-600",
};

const PRIORITY_TONES: Record<string, string> = {
  HIGH: "bg-danger/10 text-danger",
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-amber-500/10 text-amber-600",
  URGENT: "bg-danger/15 text-danger",
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Pill({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
        className,
      )}
    >
      {label}
    </span>
  );
}

function JobCard({ job }: { job: ProviderJob }) {
  const where = [job.hostelArea, job.hostelCity].filter(Boolean).join(", ");

  return (
    <article className="rounded-xl border border-border bg-surface p-5 transition hover:border-brand-teal/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-extrabold text-foreground">
            {job.title}
          </h2>
          <p className="mt-1 text-sm font-semibold text-brand-teal">{job.hostelName}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Pill
            className={PRIORITY_TONES[job.priority] ?? PRIORITY_TONES.MEDIUM!}
            label={titleCase(job.priority)}
          />
          <Pill
            className={STATUS_TONES[job.status] ?? STATUS_TONES.PENDING!}
            label={titleCase(job.status)}
          />
        </div>
      </div>

      {job.description ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {job.description}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Wrench className="size-3.5 shrink-0 text-brand-teal" />
          <dd>{titleCase(job.category)}</dd>
        </div>
        {where || job.location ? (
          <div className="flex items-center gap-2">
            <MapPin className="size-3.5 shrink-0 text-brand-teal" />
            <dd className="truncate">{[job.location, where].filter(Boolean).join(" · ")}</dd>
          </div>
        ) : null}
        {job.scheduledFor ? (
          <div className="flex items-center gap-2">
            <CalendarClock className="size-3.5 shrink-0 text-brand-teal" />
            <dd>Scheduled {formatDate(job.scheduledFor)}</dd>
          </div>
        ) : null}
        {job.hostelPhone ? (
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 shrink-0 text-brand-teal" />
            <dd>
              <a className="hover:text-brand-teal" href={`tel:${job.hostelPhone}`}>
                {job.hostelPhone}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      {job.createdAt ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Raised {formatDate(job.createdAt)}
        </p>
      ) : null}
    </article>
  );
}

export function ProviderJobsPage() {
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void browserApi<{ jobs: ProviderJob[] }>("/api/v1/public/service-providers/me/jobs")
      .then((data) => {
        if (isMounted) {
          setJobs(data.jobs);
        }
      })
      .catch(() => {
        if (isMounted) {
          setFailed(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const open = jobs?.filter((job) => OPEN_STATUSES.has(job.status)) ?? [];
  const closed = jobs?.filter((job) => !OPEN_STATUSES.has(job.status)) ?? [];

  return (
    <PublicShell active="jobs">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <div className="mb-10">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand-teal/10">
            <Briefcase className="size-6 text-brand-teal" />
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
            Your jobs
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Maintenance work hostels have assigned to you. Call the hostel directly to
            arrange a time.
          </p>
        </div>

        {jobs === null && !failed ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center">
            <p className="text-sm font-semibold text-foreground">
              Your jobs could not be loaded.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check your connection and refresh. If you are signed out,{" "}
              <Link className="font-semibold text-brand-teal" href="/login">
                sign in again
              </Link>
              .
            </p>
          </div>
        ) : jobs === null || jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
            <p className="text-sm font-semibold text-foreground">No jobs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When a hostel assigns you maintenance work, it appears here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {open.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Open · {open.length}
                </h2>
                {open.map((job) => (
                  <JobCard job={job} key={job.id} />
                ))}
              </section>
            ) : null}

            {closed.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Past work · {closed.length}
                </h2>
                {closed.map((job) => (
                  <JobCard job={job} key={job.id} />
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
