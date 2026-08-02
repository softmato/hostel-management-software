"use client";

import {
  AlertTriangle,
  Bell,
  CreditCard,
  Home,
  Moon,
  Siren,
  Star,
  Utensils,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { currency, EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { ResidentQuestionCallCard } from "./resident-questioncall-card";
import { type ResidentDashboard, Message } from "./resident-shared";
import {
  EmptyInline,
  InitialsAvatar,
  MetricCard,
  PortalPageHeader,
  RoleButton,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
  ViewAllLink,
} from "./portal-dashboard-ui";

const quickActionTones = [
  "bg-emerald-50 text-emerald-600",
  "bg-violet-50 text-violet-600",
  "bg-rose-50 text-rose-600",
  "bg-orange-50 text-orange-600",
  "bg-amber-50 text-amber-600",
];

export const ResidentDashboardPageContent = memo(function ResidentDashboardPageContent() {
  const dashboardResource = usePortalResource<{ dashboard: ResidentDashboard }>(
    residentEndpoints.dashboard,
    { errorMessage: "Could not load dashboard." },
  );

  const dashboard = dashboardResource.data?.dashboard ?? null;
  const state = dashboardResource.state;
  const message = dashboardResource.message;

  const firstName = dashboard?.resident.firstName ?? "Resident";
  const unreadNotices = dashboard?.notices.filter((notice) => !notice.isRead).length ?? 0;
  const roomLabel = dashboard
    ? `${dashboard.roomBed.room?.roomNumber ?? "—"} / ${dashboard.roomBed.bed?.bedNumber ?? "—"}`
    : "—";
  const latestPayment = dashboard?.feeStatus.latestPayment;

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        description="Here's what's happening at your hostel today."
        title={`Welcome back, ${firstName}! 👋`}
      />
      <Message value={message} />
      {state === "loading" ? <LoadingRows /> : null}
      {state === "error" ? <EmptyState label="Dashboard could not be loaded." /> : null}

      {dashboard ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Home}
              label="Room / Bed"
              tone="green"
              trend={dashboard.hostel?.name ?? "Your room"}
              value={roomLabel}
            />
            <MetricCard
              icon={WalletCards}
              label="Fee Status"
              tone="amber"
              trend={
                dashboard.feeStatus.dueAmount > 0
                  ? `${dashboard.feeStatus.unpaidCount} unpaid item(s)`
                  : "All clear"
              }
              value={currency(dashboard.feeStatus.dueAmount)}
            />
            <MetricCard
              icon={Bell}
              label="Unread Notices"
              tone="purple"
              trend="New notices"
              value={String(unreadNotices)}
            />
            <MetricCard
              icon={Moon}
              label="Night Status"
              tone="cyan"
              trend={
                dashboard.nightStatus.checkedAt
                  ? `Checked at ${new Date(dashboard.nightStatus.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Not checked in"
              }
              value={dashboard.nightStatus.status.replaceAll("_", " ")}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_0.95fr]">
            <SectionCard
              actions={
                <ViewAllLink
                  href="/resident/food"
                  label="View Full Menu →"
                  tone="resident"
                />
              }
              title="Today's Menu"
            >
              {dashboard.foodMenu.length === 0 ? (
                <EmptyInline label="No menu posted today." />
              ) : (
                <div className="space-y-3">
                  {dashboard.foodMenu.map((menu) => (
                    <div
                      className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/15 p-3"
                      key={menu.mealType}
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-role-resident-soft text-role-resident">
                        <Utensils className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-foreground">{menu.mealType}</p>
                          <SoftBadge tone="green">{menu.timing}</SoftBadge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {menu.items.join(", ")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="space-y-5">
              <SectionCard title="Quick Actions">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {[
                    { href: "/resident/payments", icon: CreditCard, label: "Payments" },
                    { href: "/resident/notices", icon: Bell, label: "Notices" },
                    {
                      href: "/resident/complaints",
                      icon: AlertTriangle,
                      label: "Complaints",
                    },
                    { href: "/resident/sos", icon: Siren, label: "SOS" },
                    { href: "/resident/reviews", icon: Star, label: "Reviews" },
                  ].map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        className="flex flex-col items-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3 text-center shadow-sm transition hover:border-role-resident/40 hover:bg-role-resident-soft/30"
                        href={item.href}
                        key={item.href}
                      >
                        <span
                          className={`flex size-10 items-center justify-center rounded-xl ${quickActionTones[index % quickActionTones.length]}`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="text-[11px] font-semibold text-foreground">
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard
                actions={<ViewAllLink href="/resident/notices" tone="resident" />}
                title="Recent Notices"
              >
                {dashboard.notices.length === 0 ? (
                  <EmptyInline label="No notices." />
                ) : (
                  <div className="space-y-2">
                    {dashboard.notices.slice(0, 4).map((notice) => (
                      <div
                        className="rounded-xl border border-border/80 px-3 py-2.5"
                        key={notice.id}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {notice.title}
                          </p>
                          {notice.isUrgent ? (
                            <SoftBadge tone="rose">Urgent</SoftBadge>
                          ) : null}
                          {!notice.isRead ? (
                            <SoftBadge tone="green">New</SoftBadge>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {notice.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="space-y-5">
              <SectionCard title="Payment Due">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {latestPayment?.month ?? "Current dues"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {latestPayment?.dueDate
                          ? `Due ${new Date(latestPayment.dueDate).toLocaleDateString()}`
                          : "Check payments for schedule"}
                      </p>
                    </div>
                    {dashboard.feeStatus.dueAmount > 0 ? (
                      <SoftBadge tone="rose">Due</SoftBadge>
                    ) : (
                      <SoftBadge tone="green">Clear</SoftBadge>
                    )}
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {currency(dashboard.feeStatus.dueAmount)}
                  </p>
                  <RoleButton asChild className="w-full" tone="resident">
                    <Link href="/resident/payments">Pay Now</Link>
                  </RoleButton>
                  {latestPayment ? (
                    <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Latest:{" "}
                      <SoftBadge tone={statusToneFromLabel(latestPayment.status)}>
                        {latestPayment.status}
                      </SoftBadge>{" "}
                      · {currency(latestPayment.paidAmount)} paid
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                actions={<ViewAllLink href="/resident/payments" tone="resident" />}
                title="Recent Payments"
              >
                {latestPayment ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2.5">
                      <div>
                        <p className="font-semibold text-foreground">
                          {latestPayment.month}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {latestPayment.dueDate
                            ? new Date(latestPayment.dueDate).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <SoftBadge tone={statusToneFromLabel(latestPayment.status)}>
                          {latestPayment.status.replaceAll("_", " ")}
                        </SoftBadge>
                        <p className="mt-1 font-semibold text-foreground">
                          {currency(latestPayment.paidAmount || latestPayment.dueAmount)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyInline label="No payment history yet." />
                )}
              </SectionCard>
            </div>
          </div>

          <SectionCard title="Your Hostel">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {dashboard.hostel?.photoUrl ? (
                  <div
                    className="size-16 rounded-xl bg-cover bg-center shadow-sm"
                    style={{ backgroundImage: `url("${dashboard.hostel.photoUrl}")` }}
                  />
                ) : (
                  <InitialsAvatar
                    name={dashboard.hostel?.name ?? "Hostel"}
                    size="lg"
                    tone="resident"
                  />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-foreground">
                      {dashboard.hostel?.name ?? "Hostel"}
                    </p>
                    <SoftBadge tone="green">Verified</SoftBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[dashboard.hostel?.location?.area, dashboard.hostel?.location?.city]
                      .filter(Boolean)
                      .join(", ") || "Location not set"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[dashboard.hostel?.contact?.phone, dashboard.hostel?.contact?.email]
                      .filter(Boolean)
                      .join(" · ") || "Contact details unavailable"}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  Your assignment
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  Room {dashboard.roomBed.room?.roomNumber ?? "—"} · Bed{" "}
                  {dashboard.roomBed.bed?.bedNumber ?? "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dashboard.roomBed.room?.roomType?.replaceAll("_", " ") ??
                    "Room type n/a"}
                </p>
              </div>
            </div>
          </SectionCard>

          {/* Students only — a working professional has no use for it, and the
              API repeats the check so hiding the card is not the gate. */}
          {(dashboard.resident.residentType ?? "STUDENT") === "STUDENT" ? (
            <ResidentQuestionCallCard />
          ) : null}
        </>
      ) : null}
    </div>
  );
});
