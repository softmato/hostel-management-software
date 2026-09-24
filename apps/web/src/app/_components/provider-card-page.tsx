"use client";

import Link from "next/link";

import { PortalPageHeader, SectionCard } from "@/app/_components/portal-dashboard-ui";
import { usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";

/**
 * The provider app's My card tab, on the web: the application as the platform
 * holds it. Read-only on every surface — it is a reviewed record, not a profile.
 */

type ProviderRecord = {
  area: string;
  availability: string;
  categories: string[];
  category: string;
  city: string;
  documentCount: number;
  email: string;
  experience: string;
  fullName: string;
  phone: string;
  /** Only set on REJECTED, written for the applicant to read. */
  rejectionReason: string;
  status: string;
  submittedAt?: string;
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ProviderCardPage() {
  const resource = usePortalResource<{ provider: ProviderRecord | null }>(
    "/api/v1/public/service-providers/me",
    { errorMessage: "Your card could not be loaded." },
  );
  const record = resource.data?.provider;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PortalPageHeader title="My card" />

      {resource.data === undefined ? (
        resource.state === "error" ? (
          <p className="text-sm text-muted-foreground">{resource.message}</p>
        ) : (
          <div className="h-48 animate-pulse rounded-xl bg-muted/50" />
        )
      ) : !record ? (
        <SectionCard>
          <p className="text-sm text-foreground">You have not applied as a service provider.</p>
          <Link
            className="mt-2 inline-block text-sm font-semibold text-brand-teal"
            href="/service-providers/register"
          >
            Apply now
          </Link>
        </SectionCard>
      ) : (
        <>
          <SectionCard>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading text-base font-bold">{record.fullName}</p>
                <p className="text-[12px] text-muted-foreground">
                  {[titleCase(record.category), record.area, record.city]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                  record.status === "APPROVED"
                    ? "bg-brand-teal/10 text-brand-teal"
                    : "bg-amber-500/10 text-amber-600",
                )}
              >
                {titleCase(record.status)}
              </span>
            </div>
            {record.rejectionReason ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground">{record.rejectionReason}</p>
            ) : null}
          </SectionCard>

          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              What the platform holds
            </h2>
            <SectionCard>
              <dl className="divide-y divide-border/60 text-[13px]">
                {[
                  ["Phone", record.phone],
                  ["Email", record.email],
                  ["Services", record.categories.map(titleCase).join(", ")],
                  ["Availability", record.availability],
                  ["Experience", record.experience],
                  ["Documents on file", String(record.documentCount)],
                  [
                    "Applied",
                    record.submittedAt
                      ? new Date(record.submittedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "",
                  ],
                ].map(([label, value]) => (
                  <div className="flex justify-between gap-4 py-2" key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
            <p className="px-1 text-[11.5px] text-muted-foreground">
              Contact support if something here is wrong.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
