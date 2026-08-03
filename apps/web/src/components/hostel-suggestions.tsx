"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";

import {
  mapPublicHostelToSummary,
  type PublicHostel,
} from "@/app/_components/public-hostel-data";
import { formatMoney, SectionCard } from "@/app/_components/shared";
import { TalkToExpertButton } from "@/components/talk-to-expert";
import { useMyExpertConsultationRequest } from "@/hooks/use-expert-consultation";
import { parseBudgetRange, topHostelMatches } from "@/lib/hostel-recommendation";
import { cn } from "@/lib/utils";

/**
 * The compare page's "platform suggestion" strip. Gated entirely by whether
 * the visitor has answered the "Talk to an Expert" form — `TalkToExpertButton`
 * already owns the sign-in → resident-profile → form gate, so this component
 * only adds one more check on top: does a saved request exist yet.
 */
export function HostelSuggestions({
  available,
  compareIds,
  onAddToCompare,
}: {
  available: PublicHostel[];
  compareIds: string[];
  onAddToCompare: (hostelId: string) => void;
}) {
  const { data: myRequest, isLoading, refetch } = useMyExpertConsultationRequest();

  if (isLoading) {
    return <div className="mb-6 h-32 animate-pulse rounded-xl border border-border bg-muted" />;
  }

  if (!myRequest) {
    return (
      <SectionCard
        action={<TalkToExpertButton onSubmitted={() => void refetch()} />}
        className="mb-6"
        title="Get hostels matched to you"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Answer a few quick questions — your budget and preferred college — and
          we&apos;ll suggest hostels that actually fit, right here on this page.
        </p>
      </SectionCard>
    );
  }

  const matches = topHostelMatches(available, myRequest, 3);

  if (matches.length === 0) {
    return null;
  }

  const hasSignal = Boolean(
    parseBudgetRange(myRequest.budgetRange) || myRequest.preferredCollege,
  );

  return (
    <SectionCard
      action={<TalkToExpertButton onSubmitted={() => void refetch()} />}
      className="mb-6"
      description={
        hasSignal
          ? "Matched to the budget and college you told our expert about."
          : "Popular verified hostels — add a budget and college next time for a tighter match."
      }
      title="Suggested for you"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map(({ distanceKm, hostel, withinBudget }) => {
          const summary = mapPublicHostelToSummary(hostel);
          const alreadyAdded = compareIds.includes(hostel.id);

          return (
            <div
              className="overflow-hidden rounded-lg border border-border bg-surface"
              key={hostel.id}
            >
              <Link className="block" href={`/hostels/${hostel.slug}`}>
                <div
                  className="h-28 bg-cover bg-center"
                  style={{ backgroundImage: `url("${summary.image}")` }}
                />
              </Link>
              <div className="space-y-2 p-3">
                <Link
                  className="block truncate text-sm font-bold text-foreground hover:text-brand-teal"
                  href={`/hostels/${hostel.slug}`}
                  title={hostel.name}
                >
                  {hostel.name}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-brand-teal-soft/60 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
                    {formatMoney(summary.price)}/mo
                  </span>
                  {withinBudget ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                      Within budget
                    </span>
                  ) : null}
                  {distanceKm != null ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      <MapPin className="size-2.5" />
                      {distanceKm < 1 ? "< 1 km away" : `${distanceKm.toFixed(1)} km away`}
                    </span>
                  ) : null}
                </div>
                <button
                  className={cn(
                    "w-full rounded-md py-1.5 text-xs font-bold transition",
                    alreadyAdded
                      ? "cursor-default bg-success/10 text-success"
                      : "bg-brand-teal text-white hover:brightness-105",
                  )}
                  disabled={alreadyAdded}
                  onClick={() => onAddToCompare(hostel.id)}
                  type="button"
                >
                  {alreadyAdded ? "Added to compare" : "Add to compare"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
