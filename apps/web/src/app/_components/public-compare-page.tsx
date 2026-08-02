"use client";

import { PhoneCall, Plus, Send, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { useCompareHostels, useHostels } from "@/hooks/use-hostels";
import { useComparisonStore } from "@/stores/comparison-store";
import { PublicShell, SectionCard, StatusPill, formatMoney } from "./shared";
import { mapPublicHostelToSummary } from "./public-hostel-data";

export function PublicComparePage() {
  const compareIds = useComparisonStore((state) => state.ids);
  const toggleCompare = useComparisonStore((state) => state.toggle);
  const removeCompare = useComparisonStore((state) => state.remove);

  const availableQuery = useHostels();
  const available = useMemo(
    () => availableQuery.data?.hostels ?? [],
    [availableQuery.data],
  );

  // Seed a default selection (first up to 3) so a direct visit to /compare is
  // not empty. Zustand action in an effect — not React setState.
  useEffect(() => {
    if (compareIds.length === 0 && available.length >= 2) {
      available.slice(0, 3).forEach((hostel) => toggleCompare(hostel.id));
    }
  }, [compareIds.length, available, toggleCompare]);

  // Guard against stale persisted ids (e.g. a hostel later unpublished).
  const validIds = useMemo(
    () => compareIds.filter((id) => available.some((hostel) => hostel.id === id)),
    [compareIds, available],
  );

  const comparisonQuery = useCompareHostels(validIds);

  const comparedHostels = useMemo(
    () => (comparisonQuery.data?.hostels ?? []).map(mapPublicHostelToSummary),
    [comparisonQuery.data],
  );

  const availableHostels = useMemo(
    () => available.map(mapPublicHostelToSummary),
    [available],
  );

  const isLoading = availableQuery.isPending || comparisonQuery.isFetching;

  const message = availableQuery.isError
    ? "Could not load hostel comparison data."
    : available.length < 2
      ? "Publish at least two verified hostels to compare them."
      : "";

  const rows = [
    ["Hostel", "name"],
    ["Monthly Rent", "price"],
    ["Location", "area"],
    ["Room Types", "roomTypes"],
    ["Vacant", "vacancy"],
    ["Food Score", "foodScore"],
    ["Facilities", "facilities"],
    ["Verification", "verified"],
    ["Rating & Reviews", "rating"],
  ] as const;

  const addHostel = () => {
    const next = availableHostels.find((hostel) => !compareIds.includes(hostel.id));
    if (!next) {
      return;
    }
    const added = toggleCompare(next.id);
    if (!added) {
      window.alert("You can compare up to 3 hostels side-by-side.");
    }
  };

  return (
    <PublicShell active="compare">
      <section className="mx-auto max-w-[1360px] px-6 py-8">
        <div className="mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Compare Hostels</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Compare verified hostels side by side and choose the best place that fits
              your needs.
            </p>
          </div>
          {comparedHostels.length < 3 && (
            <button
              onClick={addHostel}
              className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white shadow hover:brightness-105 transition flex items-center gap-1.5"
            >
              <Plus className="size-4" /> Add Another Hostel
            </button>
          )}
        </div>

        <div className="flex gap-4 mb-4">
          <Link
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
            href="/hostels"
          >
            &larr; Back to Hostels
          </Link>
        </div>
        {message ? (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
            {message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl border border-border bg-muted" />
        ) : comparedHostels.length === 0 ? (
          <SectionCard>
            <div className="p-10 text-center text-sm text-muted-foreground">
              No hostels selected. Pick hostels from the{" "}
              <Link
                className="font-semibold text-brand-teal hover:underline"
                href="/hostels"
              >
                listing page
              </Link>{" "}
              to compare them here.
            </div>
          </SectionCard>
        ) : (
          <SectionCard className="overflow-x-auto">
            <div
              className="min-w-[800px] grid"
              style={{
                gridTemplateColumns: `220px repeat(${comparedHostels.length}, 1fr)`,
              }}
            >
              {/* Left Criteria column */}
              <div className="border-r border-border bg-muted/50">
                <div className="h-44 flex items-center px-5 border-b border-border bg-muted">
                  <span className="font-bold text-sm text-foreground uppercase tracking-wider">
                    Comparison Criteria
                  </span>
                </div>
                <div className="divide-y divide-border/60 text-xs font-semibold text-muted-foreground">
                  {rows.map(([label]) => (
                    <div key={label} className="h-14 flex items-center px-5">
                      {label}
                    </div>
                  ))}
                  <div className="h-20 flex items-center px-5">Actions</div>
                </div>
              </div>

              {/* Hostel columns */}
              {comparedHostels.map((hostel) => (
                <div
                  className="border-r border-border last:border-r-0 relative"
                  key={hostel.id}
                >
                  {/* Delete header button */}
                  <button
                    onClick={() => removeCompare(hostel.id)}
                    className="absolute right-3 top-3 z-20 size-7 bg-surface/90 hover:bg-red-50 hover:text-danger rounded-full border border-border flex items-center justify-center text-muted-foreground transition shadow-sm"
                    title="Remove from comparison"
                  >
                    <X className="size-3.5" />
                  </button>

                  {/* Card header */}
                  <div className="h-44 border-b border-border bg-surface p-4 flex flex-col justify-end">
                    <div
                      className="absolute inset-0 h-32 bg-cover bg-center opacity-90"
                      style={{ backgroundImage: `url("${hostel.image}")` }}
                    />
                    <div className="absolute inset-0 h-32 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
                    <div className="relative z-10 pt-24">
                      <StatusPill
                        tone="success"
                        className="text-[9px] py-0 px-1 rounded-sm w-fit mb-1"
                      >
                        Verified
                      </StatusPill>
                      <h2
                        className="font-bold text-sm text-foreground truncate"
                        title={hostel.name}
                      >
                        {hostel.name}
                      </h2>
                    </div>
                  </div>

                  {/* Criteria Values rows */}
                  <div className="divide-y divide-border/60 text-xs text-foreground">
                    {/* Name */}
                    <div className="h-14 flex items-center px-5 font-semibold truncate bg-surface">
                      {hostel.name}
                    </div>
                    {/* Rent */}
                    <div className="h-14 flex items-center px-5 font-extrabold text-brand-teal bg-surface">
                      {formatMoney(hostel.price)}{" "}
                      <span className="text-[10px] font-normal text-muted-foreground ml-1">
                        / month
                      </span>
                    </div>
                    {/* Location */}
                    <div className="h-14 flex items-center px-5 bg-surface truncate">
                      {hostel.address}
                    </div>
                    {/* Room Types */}
                    <div className="h-14 flex items-center px-5 bg-surface truncate">
                      {hostel.roomTypes.join(", ")}
                    </div>
                    {/* Vacancy */}
                    <div className="h-14 flex items-center px-5 font-bold text-success bg-surface">
                      {hostel.vacancy} Rooms Available
                    </div>
                    {/* Food Score */}
                    <div className="h-14 flex items-center px-5 bg-surface">
                      3 Times (Veg & Non-Veg included)
                    </div>
                    {/* Facilities */}
                    <div className="h-14 flex items-center gap-1 px-5 bg-surface overflow-hidden">
                      {hostel.facilities.slice(0, 3).map((f) => (
                        <span
                          key={f}
                          className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                          title={f}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                    {/* Verification */}
                    <div className="h-14 flex items-center px-5 bg-surface">
                      <StatusPill tone="success" className="text-[10px]">
                        Verified Profile
                      </StatusPill>
                    </div>
                    {/* Rating */}
                    <div className="h-14 flex items-center gap-1 px-5 bg-surface font-semibold">
                      <Star className="size-3.5 fill-warning text-warning" />
                      <span>{hostel.rating}</span>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        ({hostel.reviews} reviews)
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="h-20 flex flex-col justify-center px-4 bg-muted gap-1.5 border-t border-border">
                    <Link
                      className="w-full text-center py-2 rounded-md bg-brand-teal text-white text-[11px] font-bold shadow hover:brightness-105 transition flex items-center justify-center gap-1"
                      href={`/inquiry?hostel=${hostel.slug}`}
                    >
                      <Send className="size-3" /> Send Inquiry
                    </Link>
                    <Link
                      className="w-full text-center text-[10px] font-semibold text-brand-teal hover:underline"
                      href={`/hostels/${hostel.slug}`}
                    >
                      View Details &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Support helper */}
        <div className="mt-8 p-5 rounded-xl border border-border bg-surface flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 text-left">
            <div className="size-12 rounded-full bg-brand-teal-soft flex items-center justify-center text-brand-teal shrink-0">
              <PhoneCall className="size-6" />
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">
                Need help choosing the right hostel?
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Our discovery experts will guide you to find the ideal accommodation based
                on your college or workplace location.
              </p>
            </div>
          </div>
          <Link
            href="/contact"
            className="rounded-lg border border-slate-900 bg-slate-900 text-white font-semibold text-xs px-5 py-2.5 hover:bg-slate-800 transition whitespace-nowrap shrink-0"
          >
            Talk to an Expert
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
