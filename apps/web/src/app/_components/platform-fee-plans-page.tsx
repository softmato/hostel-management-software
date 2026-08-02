"use client";

import { BadgeCheck, Layers, Pencil, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { EmptyState, LoadingRows, Panel } from "@/app/_components/shared-ui";
import {
  DataTable,
  MetricCard,
  PortalPageHeader,
  RoleButton,
  SoftBadge,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
} from "@/app/_components/portal-dashboard-ui";
import type { SiteConfig } from "@/modules/platform-config/site-config.validation";
import { cn } from "@/lib/utils";
import { platformEndpoints } from "@/lib/platform-endpoints";
import { usePortalResource } from "@/lib/portal-query";
import { Message } from "./core-portal-shared";

export const PlatformFeePlansPageContent = memo(function PlatformFeePlansPageContent() {
  const configResource = usePortalResource<{ config: SiteConfig }>(
    platformEndpoints.siteConfig,
    { errorMessage: "Could not load fee plans." },
  );
  const plans = configResource.data?.config.pricing ?? [];
  const { message, state } = configResource;

  const featured = plans.find((plan) => plan.highlighted);

  return (
    <div className="mx-auto max-w-[1448px] space-y-4">
      <PortalPageHeader
        actions={
          <RoleButton asChild tone="platform">
            <Link href="/platform/config/pricing">
              <Pencil className="size-3.5" />
              Edit Plans
            </Link>
          </RoleButton>
        }
        breadcrumb={["Home", "Fees & Payments", "Fee Plans"]}
        description="The subscription tiers hostels can buy. This is the same catalogue rendered on the public pricing page — edit it under Website Config."
        title="Fee Plans"
      />
      <Message value={message} />

      {state === "loading" ? <LoadingRows /> : null}
      {state === "error" ? <EmptyState label="Fee plans could not be loaded." /> : null}

      {state === "ready" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              icon={Layers}
              label="Active Plans"
              note="Shown on the pricing page"
              tone="teal"
              value={plans.length}
            />
            <MetricCard
              icon={Star}
              label="Featured Plan"
              note={featured ? "Highlighted publicly" : "None highlighted"}
              noteTone={featured ? "green" : "amber"}
              tone="amber"
              value={featured?.name ?? "—"}
            />
            <MetricCard
              icon={Sparkles}
              label="Total Features Listed"
              note="Across every plan"
              tone="purple"
              value={plans.reduce((sum, plan) => sum + plan.features.length, 0)}
            />
          </div>

          {plans.length === 0 ? (
            <Panel>
              <EmptyState label="No plans configured yet — add them under Website Config → Pricing Plans." />
            </Panel>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-3">
                {plans.map((plan) => (
                  <section
                    className={cn(
                      "relative flex flex-col rounded-xl border bg-card p-4 shadow-sm",
                      plan.highlighted
                        ? "border-role-platform/40 ring-1 ring-role-platform/20"
                        : "border-border",
                    )}
                    key={plan.name}
                  >
                    {plan.highlighted ? (
                      <span className="absolute -top-2 left-4 rounded-full bg-role-platform px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Featured
                      </span>
                    ) : null}
                    <h3 className="font-heading text-[15px] font-bold text-foreground">
                      {plan.name}
                    </h3>
                    <p className="mt-0.5 min-h-[32px] text-[11.5px] text-muted-foreground">
                      {plan.description}
                    </p>
                    <p className="mt-2 text-[22px] font-bold tracking-tight text-foreground">
                      {plan.price}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                        {plan.period}
                      </span>
                    </p>
                    <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                      {plan.features.map((feature) => (
                        <li
                          className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground"
                          key={feature}
                        >
                          <BadgeCheck className="mt-px size-3.5 shrink-0 text-role-platform" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <Panel title="Plan Comparison">
                <DataTable className="min-w-[620px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Plan</Th>
                      <Th>Price</Th>
                      <Th>Billing Period</Th>
                      <Th align="center">Features</Th>
                      <Th>Public CTA</Th>
                      <Th>Visibility</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((plan) => (
                      <TableRow key={plan.name}>
                        <TableCell className="font-semibold text-foreground">
                          {plan.name}
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          {plan.price}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {plan.period}
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {plan.features.length}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {plan.ctaLabel} → {plan.ctaHref}
                        </TableCell>
                        <TableCell>
                          <SoftBadge tone={plan.highlighted ? "green" : "slate"}>
                            {plan.highlighted ? "Featured" : "Standard"}
                          </SoftBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              </Panel>
            </>
          )}
        </>
      ) : null}
    </div>
  );
});
