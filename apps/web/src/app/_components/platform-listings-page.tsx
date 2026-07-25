"use client";

import { EyeOff, Globe, Image as ImageIcon, MapPin, Star } from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useMemo, useState } from "react";

import { currency, EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  FilterBar,
  FilterSelect,
  InitialsAvatar,
  ListPager,
  MetricCard,
  PortalPageHeader,
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
import { DemoDataBadge, Hostel, Message } from "./core-portal-shared";

const TABS = [
  { key: "PUBLISHED", label: "Live" },
  { key: "APPROVED", label: "Approved, not live" },
  { key: "DRAFT", label: "Draft" },
  { key: "ALL", label: "All" },
];

const PAGE_SIZE = 10;

/**
 * A rough completeness score so the owner can spot thin listings — the same
 * signals a visitor judges a hostel on.
 */
function listingQuality(hostel: Hostel) {
  const checks = [
    hostel.photos.length >= 3,
    Boolean(hostel.description && hostel.description.length > 80),
    hostel.facilities.length >= 3,
    Boolean(hostel.pricing?.monthlyRentMin),
    Boolean(hostel.contact?.phone),
    hostel.rules.length > 0,
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const PlatformListingsPageContent = memo(function PlatformListingsPageContent() {
  const invalidate = useInvalidateResources();
  const hostelsResource = usePortalResource<{ hostels: Hostel[] }>(
    platformEndpoints.hostels,
    { errorMessage: "Could not load listings." },
  );
  const [actionMessage, setActionMessage] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("PUBLISHED");
  const [cityFilter, setCityFilter] = useState("");
  const [page, setPage] = useState(1);

  const hostels = useMemo(
    () => hostelsResource.data?.hostels ?? [],
    [hostelsResource.data],
  );
  const state = hostelsResource.state;
  const message = actionMessage || hostelsResource.message;

  const action = useCallback(
    async (hostelId: string, next: "publish" | "unpublish") => {
      let body = JSON.stringify({});

      if (next === "unpublish") {
        // Required: the owner is emailed this reason verbatim.
        const reason = window
          .prompt("Why is this listing being unpublished? The owner will see this reason.")
          ?.trim();
        if (!reason) return;
        body = JSON.stringify({ reason });
      }

      try {
        const result = await browserApi<{
          notification?: { reason?: string; sent: boolean; to?: string };
        }>(`${platformEndpoints.hostels}/${hostelId}/${next}`, {
          body,
          method: "PATCH",
        });

        const notification = result?.notification;

        setActionMessage(
          notification && !notification.sent
            ? `Listing ${next}ed, but the owner was NOT emailed (${notification.reason ?? "unknown error"}). Contact ${notification.to ?? "the owner"} manually.`
            : `Listing ${next}ed.`,
        );
        invalidate(platformEndpoints.hostels, platformEndpoints.hostelDetails);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Action failed.");
      }
    },
    [invalidate],
  );

  const counts = useMemo(
    () => ({
      approved: hostels.filter((hostel) => hostel.status === "APPROVED").length,
      lowQuality: hostels.filter((hostel) => listingQuality(hostel) < 60).length,
      noPhotos: hostels.filter((hostel) => hostel.photos.length === 0).length,
      published: hostels.filter((hostel) => hostel.status === "PUBLISHED").length,
    }),
    [hostels],
  );

  const cities = useMemo(
    () =>
      Array.from(
        new Set(hostels.map((hostel) => hostel.location.city).filter(Boolean)),
      ) as string[],
    [hostels],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return hostels.filter((hostel) => {
      if (tab !== "ALL" && hostel.status !== tab) return false;
      if (cityFilter && hostel.location.city !== cityFilter) return false;
      if (!term) return true;
      return `${hostel.name} ${hostel.slug} ${hostel.location.area}`
        .toLowerCase()
        .includes(term);
    });
  }, [cityFilter, hostels, query, tab]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const tabCount = (key: string) =>
    key === "ALL"
      ? hostels.length
      : hostels.filter((hostel) => hostel.status === key).length;

  return (
    <div className="mx-auto max-w-[1448px] space-y-4">
      <PortalPageHeader
        breadcrumb={["Home", "Listings"]}
        description="Manage what the public actually sees — live listings, their completeness, and visibility."
        title="Listings"
      />
      <Message value={message} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Globe}
          label="Live Listings"
          note="Visible to the public"
          noteTone="green"
          tone="green"
          value={counts.published}
        />
        <MetricCard
          icon={Star}
          label="Approved, Not Live"
          note="Ready to publish"
          noteTone="amber"
          tone="amber"
          value={counts.approved}
        />
        <MetricCard
          icon={ImageIcon}
          label="Missing Photos"
          note="Hurts conversion"
          noteTone="rose"
          tone="rose"
          value={counts.noPhotos}
        />
        <MetricCard
          icon={MapPin}
          label="Thin Listings"
          note="Under 60% complete"
          noteTone="amber"
          tone="teal"
          value={counts.lowQuality}
        />
      </div>

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
            placeholder="Search listings by name or area..."
            value={query}
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              defaultLabel="All Cities"
              onChange={(next) => {
                setCityFilter(next);
                setPage(1);
              }}
              options={cities}
              value={cityFilter}
            />
            <FilterSelect
              defaultLabel="All Types"
              options={["BOYS", "GIRLS", "CO_LIVING"]}
            />
          </div>
        </FilterBar>

        {state === "loading" ? <LoadingRows /> : null}
        {state === "error" ? <EmptyState label="Listings could not be loaded." /> : null}
        {state === "ready" && filtered.length === 0 ? (
          <EmptyState label="No listings match these filters." />
        ) : null}

        {state === "ready" && filtered.length > 0 ? (
          <>
            <DataTable className="min-w-[900px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Listing</Th>
                  <Th>Location</Th>
                  <Th>Type</Th>
                  <Th align="right">From</Th>
                  <Th align="center">Photos</Th>
                  <Th>Completeness</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((hostel) => {
                  const quality = listingQuality(hostel);

                  return (
                    <TableRow key={hostel.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <InitialsAvatar name={hostel.name} size="sm" tone="platform" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                className="truncate font-semibold text-foreground hover:text-role-platform"
                                href={`/platform/hostels/${hostel.id}`}
                              >
                                {hostel.name}
                              </Link>
                              {hostel.isDemoData ? (
                                <DemoDataBadge label={hostel.demoDataLabel} />
                              ) : null}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              /{hostel.slug}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {hostel.location.area}
                        {hostel.location.city ? `, ${hostel.location.city}` : ""}
                      </TableCell>
                      <TableCell>
                        <SoftBadge tone="teal">
                          {hostel.hostelType.replaceAll("_", " ")}
                        </SoftBadge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {hostel.pricing?.monthlyRentMin
                          ? currency(hostel.pricing.monthlyRentMin)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {hostel.photos.length}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <span
                              className={
                                quality >= 80
                                  ? "block h-full rounded-full bg-emerald-500"
                                  : quality >= 60
                                    ? "block h-full rounded-full bg-amber-500"
                                    : "block h-full rounded-full bg-rose-500"
                              }
                              style={{ width: `${quality}%` }}
                            />
                          </span>
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {quality}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <SoftBadge tone={statusToneFromLabel(hostel.status)}>
                          {hostel.status.replaceAll("_", " ")}
                        </SoftBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {hostel.status === "PUBLISHED" ? (
                            <>
                              <a
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-role-platform transition hover:bg-role-platform-soft"
                                href={`/hostels/${hostel.slug}`}
                                rel="noreferrer noopener"
                                target="_blank"
                              >
                                <Globe className="size-3.5" />
                                View
                              </a>
                              <button
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                                onClick={() => action(hostel.id, "unpublish")}
                                type="button"
                              >
                                <EyeOff className="size-3.5" />
                                Unpublish
                              </button>
                            </>
                          ) : hostel.status === "APPROVED" ? (
                            <button
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                              onClick={() => action(hostel.id, "publish")}
                              type="button"
                            >
                              <Globe className="size-3.5" />
                              Publish
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
            <ListPager
              onPageChange={setPage}
              page={page}
              pageSize={PAGE_SIZE}
              showPageSize
              total={filtered.length}
              unit="listings"
            />
          </>
        ) : null}
      </Panel>
    </div>
  );
});
