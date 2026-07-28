"use client";

import { BedDouble, Coins, PiggyBank, Receipt } from "lucide-react";
import { memo, useMemo } from "react";

import { currency, EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  MetricCard,
  PortalPageHeader,
  SoftBadge,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
} from "@/app/_components/portal-dashboard-ui";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { combineResources, usePortalResource } from "@/lib/portal-query";
import { Message, RoomConfiguration } from "./core-portal-shared";

type Payment = {
  dueAmount: number;
  id: string;
  month: string;
  paidAmount: number;
  status: string;
};

/**
 * Fee plans are derived from what the hostel actually charges: each distinct
 * room type carries its own rent, and the recorded payments show what is really
 * being billed for it. That keeps this page truthful without a separate
 * fee-plan collection.
 */
type DerivedPlan = {
  beds: number;
  billed: number;
  collected: number;
  rooms: number;
  roomType: string;
};

export const HostelAdminFeePlansPageContent = memo(
  function HostelAdminFeePlansPageContent() {
    const errorMessage = "Could not load fee plans.";
    // Both entries are shared: the profile with Profile/Rooms, the payments with
    // Transactions — so this page usually paints from cache.
    const profileResource = usePortalResource<{
      hostel: { roomConfigurations: RoomConfiguration[] };
    }>(hostelAdminEndpoints.profile, { errorMessage });
    const paymentsResource = usePortalResource<{ payments: Payment[] }>(
      hostelAdminEndpoints.transactions,
      { errorMessage },
    );

    const configurations = useMemo(
      () => profileResource.data?.hostel.roomConfigurations ?? [],
      [profileResource.data],
    );
    const payments = useMemo(
      () => paymentsResource.data?.payments ?? [],
      [paymentsResource.data],
    );
    const { message, state } = combineResources(profileResource, paymentsResource);

    const plans = useMemo<DerivedPlan[]>(() => {
      const byType = new Map<string, DerivedPlan>();

      for (const config of configurations) {
        const key = config.roomType || "STANDARD";
        const existing = byType.get(key) ?? {
          beds: 0,
          billed: 0,
          collected: 0,
          rooms: 0,
          roomType: key,
        };

        existing.rooms += config.rooms;
        existing.beds += config.rooms * config.bedsPerRoom;
        byType.set(key, existing);
      }

      return [...byType.values()].sort((a, b) => b.beds - a.beds);
    }, [configurations]);

    const totals = useMemo(
      () => ({
        billed: payments.reduce((sum, payment) => sum + payment.dueAmount, 0),
        collected: payments.reduce((sum, payment) => sum + payment.paidAmount, 0),
        // Average of what residents are actually billed per month.
        monthlyAverage:
          payments.length > 0
            ? Math.round(
                payments.reduce((sum, payment) => sum + payment.dueAmount, 0) /
                  payments.length,
              )
            : 0,
      }),
      [payments],
    );

    const totalBeds = plans.reduce((sum, plan) => sum + plan.beds, 0);

    return (
      <div className="mx-auto max-w-[1448px] space-y-4">
        <PortalPageHeader
          breadcrumb={["Home", "Fees & Payments", "Fee Plans"]}
          description="What this hostel charges, broken down by room type, alongside actual billing and collection."
          title="Fee Plans"
        />
        <Message value={message} />

        {state === "loading" ? <LoadingRows /> : null}
        {state === "error" ? <EmptyState label="Fee plans could not be loaded." /> : null}

        {state === "ready" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Coins}
                label="Average Monthly Fee"
                note="Across recorded bills"
                tone="cyan"
                value={currency(totals.monthlyAverage)}
              />
              <MetricCard
                icon={Receipt}
                label="Total Billed"
                note="All recorded payments"
                tone="teal"
                value={currency(totals.billed)}
              />
              <MetricCard
                icon={PiggyBank}
                label="Total Collected"
                note="Money received"
                noteTone="green"
                tone="green"
                value={currency(totals.collected)}
              />
              <MetricCard
                icon={BedDouble}
                label="Chargeable Beds"
                note={`${plans.length} room type${plans.length === 1 ? "" : "s"}`}
                tone="purple"
                value={totalBeds}
              />
            </div>

            <Panel title="Plans by Room Type">
              {plans.length === 0 ? (
                <EmptyState label="No rooms configured yet — add rooms and beds first." />
              ) : (
                <DataTable className="min-w-[620px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Room Type</Th>
                      <Th align="center">Rooms</Th>
                      <Th align="center">Beds</Th>
                      <Th align="right">Share of Capacity</Th>
                      <Th>Status</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((plan) => {
                      const share =
                        totalBeds > 0 ? Math.round((plan.beds / totalBeds) * 100) : 0;

                      return (
                        <TableRow key={plan.roomType}>
                          <TableCell className="font-semibold text-foreground">
                            {plan.roomType.replaceAll("_", " ")}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {plan.rooms}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {plan.beds}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-role-admin"
                                  style={{ width: `${share}%` }}
                                />
                              </span>
                              <span className="text-[11px] font-semibold text-muted-foreground">
                                {share}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <SoftBadge tone="green">Active</SoftBadge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </DataTable>
              )}
              <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-4 text-muted-foreground">
                Per-resident rent, deposit, and add-on charges are set when recording a
                payment. Dedicated fee-plan templates arrive with the billing module.
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    );
  },
);
