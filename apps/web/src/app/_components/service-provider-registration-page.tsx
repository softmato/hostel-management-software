"use client";

import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  MapPin,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";

import { GoogleAuthButton } from "@/app/(auth)/google-auth-button";
import { FileUploaderView, useUploader } from "@/components/uploads";
import { browserApi } from "@/lib/browser-api";
import { checkAuthWithRefresh } from "@/lib/auth-check";
import { cn } from "@/lib/utils";
import { PublicShell } from "./shared";
import { SiteName, useSiteConfig } from "@/components/site-config-provider";
import { resolveContentPage } from "@/lib/site-content";
import { useConfirm } from "@/app/_components/confirm-dialog";
import { useHasResidentIdCard } from "@/lib/use-resident-id-card";

/**
 * Public service-provider registration (PHASES.md §6.1 "Service Provider Mobile
 * App"). Two steps, in the order the phase plan requires:
 *
 *  1. Google sign-in — the gate exists so the email on the application is one
 *     Google has verified. Approval later upgrades *that* account from PUBLIC to
 *     SERVICE_PROVIDER, so a self-typed address would break the upgrade.
 *  2. Trade details — everything else, with the email locked to the identity
 *     from step 1.
 *
 * There is deliberately no provider dashboard on the web: an approved provider
 * works out of the mobile app, and this page says so.
 */

const CATEGORIES = [
  "PLUMBER",
  "ELECTRICIAN",
  "DOCTOR_CLINIC",
  "INTERNET_TECHNICIAN",
  "CLEANER",
  "CARPENTER",
  "PAINTER",
  "WATER_SUPPLIER",
  "APPLIANCE_REPAIR",
  "ROOM_REPAIR",
  "OTHER",
] as const;

/** Mockup's dark-to-brand green hero, derived from the brand token so the
 *  gradient stays correct if the brand colour is ever retuned. */
const HERO_GRADIENT =
  "bg-[linear-gradient(160deg,color-mix(in_srgb,var(--brand-teal)_45%,#000)_0%,color-mix(in_srgb,var(--brand-teal)_75%,#000)_50%,var(--brand-teal)_100%)]";

const FIELD_SHELL =
  "mt-2 flex h-12 items-center gap-3 rounded-xl border border-border bg-surface px-3 shadow-sm transition focus-within:border-brand-teal focus-within:ring-2 focus-within:ring-brand-teal/15";
const FIELD_INPUT =
  "h-full w-full bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground";
const LABEL = "block text-sm font-semibold text-foreground";

type SessionUser = {
  email: string | null;
  name: string;
  phone: string | null;
  role: string;
};

type MeResponse = {
  success: boolean;
  data?: { user: SessionUser };
};

type ProviderStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "HIDDEN"
  | "INACTIVE";

/** The caller's own application, as returned by `/public/service-providers/me`. */
type OwnApplication = {
  area: string;
  availability: string;
  categories: string[];
  category: string;
  city: string;
  description: string;
  documentCount: number;
  email: string;
  experience: string;
  fullName: string;
  id: string;
  phone: string;
  rejectionReason: string;
  status: ProviderStatus;
  submittedAt?: string;
};

/** A REJECTED applicant may apply again; every other status is still in play. */
function isApplicationOpen(status: ProviderStatus) {
  return status !== "REJECTED";
}

function categoryLabel(category: string) {
  return category
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[clamp(1.9rem,3vw,2.6rem)] font-extrabold leading-none text-white">
        {value}
      </div>
      <div className="mt-2 text-[13px] whitespace-nowrap text-white/70">{label}</div>
    </div>
  );
}

const STATUS_PANEL: Record<
  ProviderStatus,
  { body: string; heading: string; tone: "info" | "success" | "warning" }
> = {
  APPROVED: {
    body: "You're listed as a verified provider. Jobs are broadcast to the Provider mobile app — sign in there with the credentials we emailed you.",
    heading: "Approved",
    tone: "success",
  },
  HIDDEN: {
    body: "Your listing is temporarily hidden by the platform, so you won't receive new job broadcasts right now. Contact support if this is unexpected.",
    heading: "Listing hidden",
    tone: "warning",
  },
  INACTIVE: {
    body: "Your listing is marked inactive and won't receive new job broadcasts. Contact support to reactivate it.",
    heading: "Listing inactive",
    tone: "warning",
  },
  PENDING_APPROVAL: {
    body: "Our team is checking your details and documents. This usually takes about two days — we'll email you the moment there's a decision.",
    heading: "Under review",
    tone: "info",
  },
  REJECTED: {
    body: "Your application wasn't approved. You can correct the details and submit again.",
    heading: "Not approved",
    tone: "warning",
  },
};

const STATUS_TONE = {
  info: "border-brand-teal/30 bg-brand-teal-soft text-brand-teal",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
} as const;

/** Shown in place of the CTA once the signed-in account already has an application. */
function ApplicationStatusPanel({
  application,
  onReapply,
  onViewDetails,
}: {
  application: OwnApplication;
  onReapply: () => void;
  onViewDetails: () => void;
}) {
  const panel = STATUS_PANEL[application.status];

  return (
    <div className="mt-5">
      <div
        className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${STATUS_TONE[panel.tone]}`}
      >
        {application.status === "APPROVED" ? (
          <BadgeCheck className="size-5 shrink-0" />
        ) : (
          <Clock className="size-5 shrink-0" />
        )}
        {panel.heading}
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        {panel.body}
      </p>

      {application.rejectionReason ? (
        <p className="mt-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Reason:</strong>{" "}
          {application.rejectionReason}
        </p>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-4 text-[13px]">
        <div>
          <dt className="text-muted-foreground">
            {application.categories.length > 1 ? "Trades" : "Trade"}
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {application.categories.map(categoryLabel).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Area</dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {application.area}, {application.city}
          </dd>
        </div>
        {application.submittedAt ? (
          <div>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {new Date(application.submittedAt).toLocaleDateString()}
            </dd>
          </div>
        ) : null}
      </dl>

      <button
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-semibold text-foreground transition hover:border-brand-teal hover:text-brand-teal"
        onClick={onViewDetails}
        type="button"
      >
        <FileText className="size-4" />
        View submitted details
      </button>

      {application.status === "REJECTED" ? (
        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-3.5 text-[15px] font-bold text-white transition hover:opacity-95"
          onClick={onReapply}
          type="button"
        >
          Apply again
          <ArrowRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Read-only replay of exactly what the applicant submitted. */
function SubmittedDetailsDialog({
  application,
  onClose,
}: {
  application: OwnApplication;
  onClose: () => void;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Full name", value: application.fullName },
    { label: "Phone", value: application.phone },
    { label: "Email", value: application.email || "—" },
    {
      label: application.categories.length > 1 ? "Trades" : "Trade",
      value: application.categories.map(categoryLabel).join(", "),
    },
    { label: "Area", value: `${application.area}, ${application.city}` },
    { label: "Availability", value: application.availability || "—" },
    { label: "Experience", value: application.experience || "—" },
    { label: "Description", value: application.description || "—" },
    {
      label: "Attachments",
      value:
        application.documentCount === 1 ? "1 file" : `${application.documentCount} files`,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="submitted-details-title"
        aria-modal="true"
        className="max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-border bg-card p-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              className="font-heading text-xl font-bold text-foreground"
              id="submitted-details-title"
            >
              Your submitted details
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              This is what our team is reviewing.
            </p>
          </div>
          <button
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>

        <dl className="mt-6 divide-y divide-border">
          {rows.map((row) => (
            <div className="grid grid-cols-[130px_1fr] gap-4 py-3" key={row.label}>
              <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
              <dd className="text-[13px] font-medium break-words text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * Step 1 — the split hero, and the entry point for everyone. Pitch and live
 * numbers on the left; on the right the Google gate (signed out), the caller's
 * application status (already applied), or a straight "continue" into the form.
 * A signed-in visitor still gets the pitch — the landing page is what sells the
 * network, so it is never skipped just because a session exists.
 */
function LandingStep({
  application,
  isApplicationLoading,
  onContinue,
  providerCount,
  user,
}: {
  application: OwnApplication | null;
  isApplicationLoading: boolean;
  onContinue: () => void;
  providerCount: number | null;
  user: SessionUser | null;
}) {
  const [error, setError] = useState("");
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  /*
   * The hero's words come from Platform → Website Config → Page Content, so the
   * pitch a tradesperson reads here is the pitch they read on the app's Service
   * providers screen. The stats beside it stay computed — a registered-provider
   * count typed into a config field would be a number that stops being true.
   */
  const { content, identity } = useSiteConfig();
  const page = resolveContentPage(content.serviceProviders, identity);
  // The button reports the signed-in user, but this page re-reads the session
  // itself on mount — a full reload is the simplest way to come back with the
  // cookie definitely in place.
  const handleSuccess = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    /* Full-bleed: this is the landing page for the whole provider journey, so the
       split runs edge to edge and fills the viewport below the public header. */
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
      <div
        className={`relative flex flex-col justify-center overflow-hidden px-8 py-20 sm:px-14 lg:px-20 xl:px-28 ${HERO_GRADIENT}`}
      >
        <div className="absolute -right-24 -top-28 size-[420px] rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-24 size-[320px] rounded-full bg-black/10" />
        <h1 className="relative max-w-[600px] font-heading text-[clamp(2rem,4.2vw,3.25rem)] font-extrabold leading-[1.15] text-white">
          {page.subtitle}
        </h1>
        <p className="relative mt-5 max-w-[520px] text-[clamp(0.95rem,1.2vw,1.15rem)] leading-relaxed text-white/80">
          {page.intro[0]}
        </p>
        <div className="relative mt-12 flex flex-wrap gap-x-14 gap-y-8">
          <HeroStat
            label="registered providers"
            value={providerCount === null ? "—" : String(providerCount)}
          />
          <HeroStat label="categories" value={String(CATEGORIES.length)} />
          <HeroStat label="review time" value="2 days" />
        </div>
        <p className="relative mt-12 max-w-[520px] text-sm leading-relaxed text-white/60">
          {page.intro[1]}
        </p>
      </div>

      <div className="flex flex-col justify-center gap-4 bg-card px-8 py-20 sm:px-14 lg:px-20 xl:px-28">
        <div className="mx-auto w-full max-w-[440px]">
          <h2 className="font-heading text-[26px] font-bold text-foreground">
            {!user
              ? "Create your account"
              : application
                ? "Your application"
                : "Become a service provider"}
          </h2>

          {error ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          ) : null}

          {user ? (
            <>
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-teal-soft text-sm font-bold text-brand-teal">
                  {(user.name || user.email || "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {user.name || "Signed in"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.email ?? "Signed in"}
                  </span>
                </span>
              </div>

              {isApplicationLoading ? (
                <div className="mt-5 h-[52px] animate-pulse rounded-xl bg-muted/60" />
              ) : application ? (
                <>
                  <ApplicationStatusPanel
                    application={application}
                    onReapply={onContinue}
                    onViewDetails={() => setIsDetailsOpen(true)}
                  />
                  {isDetailsOpen ? (
                    <SubmittedDetailsDialog
                      application={application}
                      onClose={() => setIsDetailsOpen(false)}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-3.5 text-[15px] font-bold text-white transition hover:opacity-95"
                    onClick={onContinue}
                    type="button"
                  >
                    Continue — become a service provider
                    <ArrowRight className="size-4" />
                  </button>

                  <p className="mt-4 text-center text-[13px] text-muted-foreground">
                    Next you&apos;ll fill out your trade details
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <div className="mt-6">
                <GoogleAuthButton
                  clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""}
                  onError={setError}
                  onSuccess={handleSuccess}
                />
              </div>

              <p className="mt-4 text-center text-[13px] text-muted-foreground">
                You&apos;ll fill out your trade details after signing in
              </p>
            </>
          )}

          <div className="my-7 h-px bg-border" />

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            By continuing you agree this account is used to receive job offers from
            hostels in your category and area. No web dashboard is required — once
            approved, you&apos;ll manage jobs from the <SiteName /> Provider mobile
            app.
          </p>

          {user ? null : (
            <p className="mt-7 text-center text-[13px] text-muted-foreground">
              Already registered?{" "}
              <Link className="font-semibold text-brand-teal" href="/login">
                Log in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Step 2 — trade details. Email is fixed to the Google identity from step 1. */
function TradeDetailsStep({
  onSubmitted,
  user,
}: {
  onSubmitted: () => void;
  user: SessionUser;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Trades are multi-select — a local tradesperson is commonly a plumber *and* a
  // carpenter, and picking one would hide them from half the jobs they can do.
  // Order matters: the first picked becomes the headline trade on the listing.
  const [categories, setCategories] = useState<string[]>([]);
  // No session-scoped upload target here: the applicant is signed in as PUBLIC
  // and has no provider record yet, so both uploads go to the rate-limited
  // public route and come back as URLs the application can store directly.
  const photoUpload = useUploader({
    kind: "image",
    label: "Profile photo",
    target: "public",
  });
  const documentUpload = useUploader({
    kind: "document",
    label: "Supporting document",
    maxFiles: 8,
    target: "public",
  });
  const { clear: clearPhoto } = photoUpload;
  const { clear: clearDocuments } = documentUpload;
  // Approval re-issues an existing resident card as a provider card, so anyone
  // holding one is told before they apply rather than after it changes.
  const hasResidentCard = useHasResidentIdCard();
  const { confirm, confirmDialog } = useConfirm();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => {
      const field = form.get(name);

      return typeof field === "string" ? field.trim() : "";
    };

    if (categories.length === 0) {
      setError("Select at least one trade.");
      return;
    }

    if (
      hasResidentCard &&
      !(await confirm({
        actionLabel: "Yes, submit my application",
        description:
          "Your resident ID card will be automatically converted into a Service Provider card once your application is approved. You will no longer hold a resident card on this account.",
        title: "Apply as a service provider?",
      }))
    ) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const photoUrl = photoUpload.files[0]?.url;

      await browserApi("/api/v1/public/service-providers/register", {
        body: JSON.stringify({
          area: value("area"),
          availability: value("availability") || undefined,
          categories,
          city: value("city") || "Kathmandu",
          description: value("description") || undefined,
          documents: [
            ...(photoUrl ? [{ documentType: "PROFILE_PHOTO", fileUrl: photoUrl }] : []),
            ...documentUpload.files
              .filter((file) => Boolean(file.url))
              .map((file) => ({
                documentType: "PROFILE_DOCUMENT",
                fileUrl: file.url as string,
              })),
          ].slice(0, 8),
          email: user.email ?? undefined,
          experience: value("experience") || undefined,
          fullName: value("fullName"),
          phone: value("phone"),
        }),
        method: "POST",
      });
      formElement.reset();
      setCategories([]);
      clearPhoto();
      clearDocuments();
      onSubmitted();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not submit registration.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-10 py-5">
          <span className="text-sm font-semibold text-foreground">
            Provider registration
          </span>
          <span className="text-sm font-semibold text-muted-foreground">Step 2 of 2</span>
        </div>

        {confirmDialog}

        <form
          className="flex flex-col gap-6 px-8 py-12 sm:px-14 lg:px-20"
          onSubmit={submit}
        >
          <div>
            <h1 className="font-heading text-[26px] font-extrabold text-foreground">
              Tell us about your trade
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-4" />
              Signed in as
              <strong className="font-semibold text-foreground">
                {user.email ?? "your Google account"}
              </strong>
            </p>
          </div>

          {error ? (
            <p
              aria-live="polite"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>
              Full Name *
              <span className={FIELD_SHELL}>
                <UserRound className="size-4 text-muted-foreground" />
                <input
                  className={FIELD_INPUT}
                  defaultValue={user.name}
                  name="fullName"
                  placeholder="Enter your full name"
                  required
                />
              </span>
            </label>
            <label className={LABEL}>
              Phone *
              <span className={FIELD_SHELL}>
                <Phone className="size-4 text-muted-foreground" />
                <input
                  className={FIELD_INPUT}
                  defaultValue={user.phone ?? ""}
                  name="phone"
                  placeholder="+977"
                  required
                />
              </span>
            </label>
          </div>

          <fieldset>
            <legend className={LABEL}>Trades *</legend>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Pick every trade you work in — you&apos;ll be matched to jobs in all of
              them. The first one you pick is shown as your main trade.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((category) => {
                const index = categories.indexOf(category);
                const isSelected = index !== -1;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                      isSelected
                        ? "border-brand-teal bg-brand-teal text-white"
                        : "border-border bg-surface text-foreground hover:border-brand-teal",
                    )}
                    key={category}
                    onClick={() =>
                      setCategories((current) =>
                        current.includes(category)
                          ? current.filter((item) => item !== category)
                          : [...current, category],
                      )
                    }
                    type="button"
                  >
                    {isSelected ? <Check className="size-3.5" /> : null}
                    {categoryLabel(category)}
                    {index === 0 ? (
                      <span className="text-[11px] font-bold opacity-80">main</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>
              Area *
              <span className={FIELD_SHELL}>
                <MapPin className="size-4 text-muted-foreground" />
                <input
                  className={FIELD_INPUT}
                  name="area"
                  placeholder="Neighbourhood"
                  required
                />
              </span>
            </label>
            <label className={LABEL}>
              City *
              <span className={FIELD_SHELL}>
                <MapPin className="size-4 text-muted-foreground" />
                <input
                  className={FIELD_INPUT}
                  defaultValue="Kathmandu"
                  name="city"
                  required
                />
              </span>
            </label>
          </div>

          <label className={LABEL}>
            Availability{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
            <span className={FIELD_SHELL}>
              <CalendarDays className="size-4 text-muted-foreground" />
              <input
                className={FIELD_INPUT}
                name="availability"
                placeholder="Weekdays, emergency, on-call"
              />
            </span>
          </label>

          <label className={LABEL}>
            Experience{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea
              className="mt-2 min-h-14 w-full rounded-xl border border-border bg-surface p-3 text-sm font-normal outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15"
              name="experience"
              placeholder="e.g. 5 years fixing residential plumbing"
            />
          </label>

          <label className={LABEL}>
            Description{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-border bg-surface p-3 text-sm font-normal outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15"
              name="description"
              placeholder="Describe your service coverage, tools, and response time."
            />
          </label>

          <div className={LABEL}>
            Photo &amp; Documents{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-[160px_1fr]">
              {/* The photo becomes the provider's portrait on their ID card and
                  in the directory, so they frame it themselves. */}
              <FileUploaderView
                cropImages
                label="Profile photo"
                size="sm"
                tone="brand"
                uploader={photoUpload}
              />
              <FileUploaderView
                label="Upload citizenship, licence, certificates (up to 8)"
                size="sm"
                tone="brand"
                uploader={documentUpload}
              />
            </div>
          </div>

          <button
            className="mt-2 w-full rounded-xl bg-brand-teal px-5 py-3.5 text-[15px] font-bold text-white transition hover:opacity-95 disabled:opacity-60"
            disabled={
              isSubmitting || photoUpload.isUploading || documentUpload.isUploading
            }
          >
            {isSubmitting ? "Submitting…" : "Submit Registration"}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            You&apos;ll get an email once it&apos;s submitted, and can check status any
            time by signing back in.
          </p>
        </form>
      </div>
    </div>
  );
}

/** Step 3 — the application is in. There is no provider portal to send them to,
 *  so this is the end of the web journey by design. */
function SubmittedStep({ email }: { email: string | null }) {
  return (
    <div className="mx-auto max-w-[560px] px-6 py-16">
      <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-teal-soft text-brand-teal">
          <CheckCircle2 className="size-7" />
        </div>
        <h1 className="mt-5 font-heading text-[22px] font-extrabold text-foreground">
          Registration submitted
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Our team reviews new providers within about two days.
          {email ? (
            <>
              {" "}
              We&apos;ll email <strong className="text-foreground">{email}</strong> the
              moment a decision is made.
            </>
          ) : null}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left text-xs leading-relaxed text-muted-foreground">
          <BadgeCheck className="size-5 shrink-0 text-brand-teal" />
          Once approved, you&apos;ll receive sign-in details for the <SiteName />{" "}
          Provider
          app, where jobs are broadcast and claimed. There&apos;s no provider dashboard on
          the website.
        </div>
        <Link
          className="mt-6 inline-block text-sm font-semibold text-brand-teal"
          href="/"
        >
          Back to <SiteName />
        </Link>
      </div>
    </div>
  );
}

function ServiceProviderRegistrationPageContent({
  initialProviderCount,
}: ServiceProviderRegistrationPageProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  // `undefined` = not looked up yet, `null` = looked up, never applied.
  const [application, setApplication] = useState<OwnApplication | null | undefined>(
    undefined,
  );
  // Everyone starts on the landing hero, signed in or not — reaching the form is
  // always a deliberate click, never a side effect of having a session.
  const [step, setStep] = useState<"landing" | "form" | "submitted">("landing");
  // Server-rendered on `/service-providers` so the hero never flashes a dash;
  // the client fetch below is only the fallback for routes that cannot supply it.
  const [providerCount, setProviderCount] = useState<number | null>(
    initialProviderCount ?? null,
  );

  useEffect(() => {
    let isMounted = true;

    void checkAuthWithRefresh()
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as MeResponse | null;

        return response.ok && payload?.success ? (payload.data?.user ?? null) : null;
      })
      .catch(() => null)
      .then((sessionUser) => {
        if (isMounted) {
          setUser(sessionUser);
          setIsSessionResolved(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialProviderCount !== undefined) {
      return;
    }

    let isMounted = true;

    void browserApi<{ total: number }>("/api/v1/public/service-providers")
      .then((data) => {
        if (isMounted) {
          setProviderCount(data.total);
        }
      })
      // The hero reads "—" rather than a made-up number if this fails.
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [initialProviderCount]);

  // Has this account already applied? Only askable once there is a session.
  useEffect(() => {
    if (!user) {
      return;
    }

    let isMounted = true;

    void browserApi<{ provider: OwnApplication | null }>(
      "/api/v1/public/service-providers/me",
    )
      // A failed lookup must not strand someone who has never applied, so it
      // falls through to the normal CTA.
      .catch(() => ({ provider: null }))
      .then((data) => {
        if (isMounted) {
          setApplication(data.provider);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  const ownApplication = user ? (application ?? null) : null;
  const isApplicationLoading = Boolean(user) && application === undefined;
  // An account with a live application has nothing to submit — only a REJECTED
  // one may reach the form again. Guarded here as well as in the UI so a stale
  // `step` cannot survive the lookup resolving.
  const canOpenForm =
    Boolean(user) &&
    !isApplicationLoading &&
    (!ownApplication || !isApplicationOpen(ownApplication.status));

  return (
    <PublicShell active="providers">
      {!isSessionResolved ? (
        <div className="min-h-[calc(100vh-4rem)] animate-pulse bg-muted/40" />
      ) : step === "submitted" ? (
        <SubmittedStep email={user?.email ?? null} />
      ) : step === "form" && user && canOpenForm ? (
        <TradeDetailsStep onSubmitted={() => setStep("submitted")} user={user} />
      ) : (
        <LandingStep
          application={ownApplication}
          isApplicationLoading={isApplicationLoading}
          onContinue={() => setStep("form")}
          providerCount={providerCount}
          user={user}
        />
      )}
    </PublicShell>
  );
}

export type ServiceProviderRegistrationPageProps = {
  /** Approved-provider total, read on the server by `/service-providers`. */
  initialProviderCount?: number;
};

export function ServiceProviderRegistrationPage(
  props: ServiceProviderRegistrationPageProps,
) {
  return (
    <Suspense fallback={null}>
      <ServiceProviderRegistrationPageContent {...props} />
    </Suspense>
  );
}
