"use client";

import {
  Building2,
  CalendarDays,
  Download,
  Phone,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { type GuardianDashboard, Message } from "./daily-operations-shared";
import { currency, LoadingRows } from "@/app/_components/shared-ui";
import {
  DataTable,
  EmptyInline,
  InitialsAvatar,
  MetricCard,
  PortalPageHeader,
  RoleButton,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./portal-dashboard-ui";

export const GuardianDashboardPageContent = memo(function GuardianDashboardPageContent() {
  const [dashboard, setDashboard] = useState<GuardianDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await browserApi<{ dashboard: GuardianDashboard }>(
        "/api/v1/guardian/dashboard",
      );
      setDashboard(data.dashboard);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load guardian dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => {
    if (!dashboard) {
      return { paid: 0, due: 0, charges: 0 };
    }
    const paid = dashboard.payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
    const charges = dashboard.payments.reduce(
      (sum, payment) => sum + payment.dueAmount,
      0,
    );
    return {
      charges,
      due: dashboard.summary.dueAmount,
      paid,
    };
  }, [dashboard]);

  const residentName = dashboard
    ? `${dashboard.resident.firstName} ${dashboard.resident.lastName}`.trim()
    : "Resident";

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        description="Overview of fees, payments, and dues for your ward."
        title="Fee Summary"
      />
      <Message value={message} />
      {loading ? <LoadingRows /> : null}

      {dashboard ? (
        <>
          <SectionCard>
            <div className="grid gap-4 lg:grid-cols-[1.15fr_repeat(3,1fr)]">
              <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/15 p-4">
                <InitialsAvatar name={residentName} size="lg" tone="guardian" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-foreground">{residentName}</p>
                    <SoftBadge tone="amber">Resident</SoftBadge>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="size-3.5" />
                    {dashboard.hostel?.name ?? "Hostel"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dashboard.guardian.relation} · {dashboard.guardian.phone}
                  </p>
                </div>
              </div>

              <MetricCard
                icon={WalletCards}
                label="Paid Amount"
                tone="green"
                trend="This session"
                value={currency(totals.paid)}
              />
              <MetricCard
                icon={ReceiptText}
                label="Due Amount"
                tone="amber"
                trend={
                  dashboard.summary.unpaidCount > 0
                    ? `${dashboard.summary.unpaidCount} unpaid`
                    : "No dues"
                }
                value={currency(totals.due)}
              />
              <MetricCard
                icon={CalendarDays}
                label="Safety Status"
                tone="cyan"
                trend={
                  dashboard.safety?.checkedAt
                    ? new Date(dashboard.safety.checkedAt).toLocaleString()
                    : "Not verified recently"
                }
                value={(dashboard.safety?.status ?? "NOT_VERIFIED").replaceAll("_", " ")}
              />
            </div>
          </SectionCard>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
            <SectionCard title="Monthly Dues">
              {dashboard.payments.length === 0 ? (
                <EmptyInline label="No payment records yet." />
              ) : (
                <DataTable className="min-w-[520px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Month
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Amount
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Paid
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Receipt
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-semibold text-foreground">
                          {payment.month}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {currency(payment.dueAmount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {currency(payment.paidAmount)}
                        </TableCell>
                        <TableCell>
                          <SoftBadge tone={statusToneFromLabel(payment.status)}>
                            {payment.status.replaceAll("_", " ")}
                          </SoftBadge>
                        </TableCell>
                        <TableCell>
                          {payment.status === "PAID" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-role-guardian">
                              <Download className="size-3.5" />
                              Receipt
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              )}
            </SectionCard>

            <div className="space-y-5">
              <SectionCard title="Receipt Summary">
                <dl className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Total Paid</dt>
                    <dd className="font-semibold text-foreground">
                      {currency(totals.paid)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Total Due</dt>
                    <dd className="font-semibold text-foreground">
                      {currency(totals.due)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Total Charges</dt>
                    <dd className="font-semibold text-foreground">
                      {currency(totals.charges)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-xl border border-role-guardian/25 bg-role-guardian-soft/50 px-3 py-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Outstanding Balance
                  </p>
                  <p className="mt-1 text-2xl font-bold text-role-guardian">
                    {currency(totals.due)}
                  </p>
                </div>
                <RoleButton className="mt-4 w-full" tone="guardian" type="button">
                  <WalletCards className="size-4" />
                  Make a Payment
                </RoleButton>
              </SectionCard>

              <SectionCard title="Contact Hostel">
                <div className="flex items-start gap-3">
                  <InitialsAvatar
                    name={dashboard.hostel?.name ?? "Hostel"}
                    size="md"
                    tone="guardian"
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-foreground">
                        {dashboard.hostel?.name ?? "Hostel"}
                      </p>
                      <SoftBadge tone="green">Verified</SoftBadge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Questions about fees or safety can be directed to the hostel office.
                    </p>
                  </div>
                </div>
                <RoleButton
                  asChild
                  className="mt-4 w-full"
                  tone="guardian"
                  variant="outline"
                >
                  <Link href="/guardian/safety">
                    <Phone className="size-4" />
                    View Safety Summary
                  </Link>
                </RoleButton>
              </SectionCard>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard title="Notes from Hostel">
              {dashboard.notices.length === 0 ? (
                <EmptyInline label="No notices shared with guardians." />
              ) : (
                <div className="space-y-2">
                  {dashboard.notices.map((notice) => (
                    <div
                      className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/20"
                      key={notice.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {notice.title}
                        </p>
                        {notice.isUrgent ? (
                          <SoftBadge tone="rose">Urgent</SoftBadge>
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

            <SectionCard title="Today's Food">
              {dashboard.food.length === 0 ? (
                <EmptyInline label="No menu items available." />
              ) : (
                <div className="space-y-2">
                  {dashboard.food.map((menu) => (
                    <div
                      className="rounded-xl border border-border px-3 py-2.5"
                      key={menu.id}
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {menu.mealType}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {menu.items.join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </div>
  );
});
