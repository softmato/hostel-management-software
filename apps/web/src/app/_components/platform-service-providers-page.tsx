"use client";

import {
  BadgeCheck,
  CircleSlash,
  Clock3,
  EyeOff,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  DetailField,
  FilterBar,
  FilterSelect,
  InitialsAvatar,
  ListPager,
  MetricCard,
  PortalPageHeader,
  RailCard,
  RoleButton,
  SearchField,
  SoftBadge,
  TabBar,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
  statusToneFromLabel,
} from "@/app/_components/portal-dashboard-ui";
import { browserApi } from "@/lib/browser-api";
import { platformEndpoints } from "@/lib/platform-endpoints";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";
import { Message, type ServiceProvider } from "./portal-shared";

const TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "HIDDEN", label: "Hidden" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
];

const PAGE_SIZE = 10;

/**
 * Ratings are not yet captured for providers, so the table shows a neutral
 * placeholder instead of inventing a score. Once reviews land, swap this for the
 * real aggregate.
 */
const NO_RATING = "—";

export const PlatformServiceProvidersPageContent = React.memo(
  function PlatformServiceProvidersPageContent() {
    const [actionMessage, setActionMessage] = useState("");
    const invalidate = useInvalidateResources();
    const providersResource = usePortalResource<{ providers: ServiceProvider[] }>(
      platformEndpoints.serviceProviders,
      { errorMessage: "Could not load providers." },
    );
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState("PENDING");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [areaFilter, setAreaFilter] = useState("");
    const [availabilityFilter, setAvailabilityFilter] = useState("");
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const providers = useMemo(
      () => providersResource.data?.providers ?? [],
      [providersResource.data],
    );
    const state = providersResource.state;
    const message = actionMessage || providersResource.message;

    const moderate = useCallback(
      async (providerId: string, action: "approve" | "hide" | "reject") => {
        const reason =
          action === "reject" ? window.prompt("Rejection reason")?.trim() : undefined;

        if (action === "reject" && !reason) {
          return;
        }

        try {
          await browserApi(
            `${platformEndpoints.serviceProviders}/${providerId}/${action}`,
            {
              body: JSON.stringify(reason ? { reason } : {}),
              method: "PATCH",
            },
          );
          setActionMessage(`Provider ${action}d.`);
          invalidate(platformEndpoints.serviceProviders);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not update provider.",
          );
        }
      },
      [invalidate],
    );

    const counts = useMemo(() => {
      const by = (status: string) =>
        providers.filter((provider) => provider.status === status).length;
      return {
        approved: by("APPROVED"),
        hidden: by("HIDDEN"),
        pending: by("PENDING"),
        total: providers.length,
      };
    }, [providers]);

    const categories = useMemo(
      () =>
        Array.from(new Set(providers.map((provider) => provider.category))).filter(
          Boolean,
        ),
      [providers],
    );

    const areas = useMemo(
      () =>
        Array.from(new Set(providers.map((provider) => provider.area))).filter(Boolean),
      [providers],
    );

    const filtered = useMemo(() => {
      const term = query.trim().toLowerCase();

      return providers.filter((provider) => {
        if (tab !== "ALL" && provider.status !== tab) return false;
        if (verifiedOnly && provider.status !== "APPROVED") return false;
        if (categoryFilter && provider.category !== categoryFilter) return false;
        if (areaFilter && provider.area !== areaFilter) return false;
        if (availabilityFilter && provider.availability !== availabilityFilter) {
          return false;
        }
        if (!term) return true;

        return `${provider.fullName} ${provider.category} ${provider.area} ${provider.phone}`
          .toLowerCase()
          .includes(term);
      });
    }, [
      areaFilter,
      availabilityFilter,
      categoryFilter,
      providers,
      query,
      tab,
      verifiedOnly,
    ]);

    const paged = useMemo(
      () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      [filtered, page],
    );

    const pending = useMemo(
      () => providers.filter((provider) => provider.status === "PENDING").slice(0, 6),
      [providers],
    );

    const selected = providers.find((provider) => provider.id === selectedId) ?? null;

    const tabCount = (key: string) =>
      key === "ALL"
        ? providers.length
        : providers.filter((provider) => provider.status === key).length;

    return (
      <div className="mx-auto max-w-[1448px] space-y-4">
        <PortalPageHeader
          breadcrumb={["Home", "Service Providers"]}
          description="Approve applications and manage the verified provider network hostels can book from."
          title="Service Providers"
        />
        <Message value={message} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Users}
            label="Total Providers"
            note="All applications"
            tone="teal"
            value={counts.total}
          />
          <MetricCard
            icon={Clock3}
            label="Pending Review"
            note="Awaiting decision"
            noteTone="amber"
            tone="amber"
            value={counts.pending}
          />
          <MetricCard
            icon={BadgeCheck}
            label="Approved"
            note="Bookable by hostels"
            noteTone="green"
            tone="green"
            value={counts.approved}
          />
          <MetricCard
            icon={CircleSlash}
            label="Hidden"
            note="Temporarily delisted"
            noteTone="rose"
            tone="rose"
            value={counts.hidden}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Panel>
            <TabBar
              className="mb-3"
              onChange={(next) => {
                setTab(next);
                setPage(1);
              }}
              tabs={TABS.map((item) => ({ ...item, count: tabCount(item.key) }))}
              value={tab}
            />

            <FilterBar>
              <SearchField
                onChange={(next) => {
                  setQuery(next);
                  setPage(1);
                }}
                placeholder="Search providers by name or service..."
                value={query}
              />
              <div className="flex flex-wrap gap-2">
                <FilterSelect
                  defaultLabel="All Categories"
                  onChange={(next) => {
                    setCategoryFilter(next);
                    setPage(1);
                  }}
                  options={categories}
                  value={categoryFilter}
                />
                <FilterSelect
                  defaultLabel="All Areas"
                  onChange={(next) => {
                    setAreaFilter(next);
                    setPage(1);
                  }}
                  options={areas}
                  value={areaFilter}
                />
                <FilterSelect
                  defaultLabel="Any Availability"
                  onChange={(next) => {
                    setAvailabilityFilter(next);
                    setPage(1);
                  }}
                  options={Array.from(
                    new Set(providers.map((provider) => provider.availability)),
                  ).filter(Boolean)}
                  value={availabilityFilter}
                />
              </div>
            </FilterBar>

            <div className="mb-2.5 mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-role-platform/25 bg-role-platform-soft px-2.5 py-1 text-[11.5px] font-semibold text-role-platform">
                <input
                  checked={verifiedOnly}
                  className="size-3.5 accent-current"
                  onChange={(event) => {
                    setVerifiedOnly(event.target.checked);
                    setPage(1);
                  }}
                  type="checkbox"
                />
                <ShieldCheck className="size-3.5" />
                Verified providers only
              </label>
              <button
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground transition hover:text-foreground"
                onClick={() => {
                  setQuery("");
                  setCategoryFilter("");
                  setAreaFilter("");
                  setAvailabilityFilter("");
                  setVerifiedOnly(false);
                  setPage(1);
                }}
                type="button"
              >
                <SlidersHorizontal className="size-3.5" />
                Reset filters
              </button>
            </div>

            {state === "loading" ? <LoadingRows /> : null}
            {state === "error" ? (
              <EmptyState label="Providers could not be loaded." />
            ) : null}
            {state === "ready" && filtered.length === 0 ? (
              <EmptyState label="No providers match these filters." />
            ) : null}

            {state === "ready" && filtered.length > 0 ? (
              <>
                <DataTable className="min-w-[820px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Provider</Th>
                      <Th>Category</Th>
                      <Th>Area</Th>
                      <Th>Rating</Th>
                      <Th>Phone</Th>
                      <Th>Availability</Th>
                      <Th align="right">Actions</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((provider) => (
                      <TableRow
                        className={cn(
                          provider.id === selectedId
                            ? "bg-role-platform-soft/40"
                            : "cursor-pointer",
                        )}
                        key={provider.id}
                        onClick={() => setSelectedId(provider.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="relative">
                              <InitialsAvatar
                                name={provider.fullName}
                                size="sm"
                                tone="platform"
                              />
                              {provider.status === "APPROVED" ? (
                                <BadgeCheck className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-card text-emerald-600" />
                              ) : null}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {provider.fullName}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {provider.experience || provider.description || "—"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <SoftBadge tone="teal">{provider.category || "—"}</SoftBadge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {provider.area || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {NO_RATING}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {provider.phone || "—"}
                        </TableCell>
                        <TableCell>
                          <SoftBadge
                            tone={statusToneFromLabel(provider.availability || "slate")}
                          >
                            {provider.availability || "Unknown"}
                          </SoftBadge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {provider.phone ? (
                              <a
                                className="rounded-md border border-border p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                href={`tel:${provider.phone}`}
                                onClick={(event) => event.stopPropagation()}
                                title="Call"
                              >
                                <Phone className="size-3" />
                              </a>
                            ) : null}
                            {provider.status !== "APPROVED" ? (
                              <button
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void moderate(provider.id, "approve");
                                }}
                                type="button"
                              >
                                <BadgeCheck className="size-3.5" />
                                Approve
                              </button>
                            ) : (
                              <button
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void moderate(provider.id, "hide");
                                }}
                                type="button"
                              >
                                <EyeOff className="size-3.5" />
                                Hide
                              </button>
                            )}
                            <button
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                              onClick={(event) => {
                                event.stopPropagation();
                                void moderate(provider.id, "reject");
                              }}
                              type="button"
                            >
                              <X className="size-3.5" />
                              Reject
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
                <ListPager
                  onPageChange={setPage}
                  page={page}
                  pageSize={PAGE_SIZE}
                  showPageSize
                  total={filtered.length}
                  unit="providers"
                />
              </>
            ) : null}
          </Panel>

          <div className="space-y-4">
            <RailCard
              action={
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {counts.pending} total
                </span>
              }
              title="Pending Applications"
            >
              {pending.length === 0 ? (
                <p className="px-1 py-4 text-center text-[12px] text-muted-foreground">
                  Nothing waiting for review.
                </p>
              ) : (
                pending.map((provider) => (
                  <div
                    className="rounded-lg border border-border/70 bg-muted/15 p-2"
                    key={provider.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-foreground">
                          {provider.fullName}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground">
                          {provider.category || "Uncategorised"}
                          {provider.area ? ` · ${provider.area}` : ""}
                        </p>
                      </div>
                      <SoftBadge tone="amber">Pending</SoftBadge>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        className="flex-1 rounded-md bg-role-platform px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-role-platform/90"
                        onClick={() => void moderate(provider.id, "approve")}
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted"
                        onClick={() => void moderate(provider.id, "reject")}
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </RailCard>

            {selected ? (
              <RailCard
                action={
                  <button
                    aria-label="Close provider details"
                    className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    onClick={() => setSelectedId(null)}
                    type="button"
                  >
                    <X className="size-3.5" />
                  </button>
                }
                title="Provider Details"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <InitialsAvatar name={selected.fullName} size="md" tone="platform" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-foreground">
                      {selected.fullName}
                    </p>
                    <SoftBadge tone={statusToneFromLabel(selected.status)}>
                      {selected.status}
                    </SoftBadge>
                  </div>
                </div>

                <DetailField label="Category" value={selected.category || "—"} />
                <DetailField label="Service area" value={selected.area || "—"} />
                <DetailField label="Phone" value={selected.phone || "—"} />
                <DetailField label="Experience" value={selected.experience || "—"} />
                <DetailField label="Availability" value={selected.availability || "—"} />
                <DetailField label="Rating" value={NO_RATING} />

                {selected.description ? (
                  <p className="mt-2 border-t border-border/50 pt-2 text-[11.5px] leading-4 text-muted-foreground">
                    {selected.description}
                  </p>
                ) : null}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {selected.phone ? (
                    <RoleButton asChild tone="platform" variant="outline">
                      <a href={`tel:${selected.phone}`}>
                        <Phone className="size-3.5" />
                        Call
                      </a>
                    </RoleButton>
                  ) : null}
                  {selected.status === "APPROVED" ? (
                    <RoleButton
                      onClick={() => void moderate(selected.id, "hide")}
                      tone="platform"
                      variant="outline"
                    >
                      <EyeOff className="size-3.5" />
                      Hide
                    </RoleButton>
                  ) : (
                    <RoleButton
                      onClick={() => void moderate(selected.id, "approve")}
                      tone="platform"
                    >
                      <BadgeCheck className="size-3.5" />
                      Approve
                    </RoleButton>
                  )}
                </div>
              </RailCard>
            ) : (
              <RailCard title="Network Health">
                <DetailField
                  label="Approval rate"
                  value={
                    counts.total > 0
                      ? `${Math.round((counts.approved / counts.total) * 100)}%`
                      : "—"
                  }
                />
                <DetailField label="Categories covered" value={categories.length} />
                <DetailField label="Areas covered" value={areas.length} />
                <p className="pt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Select a provider row to inspect its application and act on it.
                </p>
              </RailCard>
            )}
          </div>
        </div>
      </div>
    );
  },
);
