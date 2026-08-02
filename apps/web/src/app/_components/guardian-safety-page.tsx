"use client";

import {
  Bell,
  Building2,
  Clock3,
  Info,
  Lock,
  MessageSquare,
  Phone,
  RefreshCw,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

import { LoadingRows } from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/browser-api";
import { type GuardianDashboard, Message } from "./daily-operations-shared";
import {
  EmptyInline,
  InitialsAvatar,
  PortalPageHeader,
  RoleButton,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
} from "./portal-dashboard-ui";

export const GuardianSafetyPageContent = memo(function GuardianSafetyPageContent() {
  const [dashboard, setDashboard] = useState<GuardianDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await browserApi<{ dashboard: GuardianDashboard }>(
        "/api/v1/guardian/dashboard",
      );
      setDashboard(data.dashboard);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load safety summary.",
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

  const residentName = dashboard
    ? `${dashboard.resident.firstName} ${dashboard.resident.lastName}`.trim()
    : "Resident";
  const safetyStatus = (dashboard?.safety?.status ?? "NOT_VERIFIED").replaceAll("_", " ");
  const safetyTone = statusToneFromLabel(dashboard?.safety?.status ?? "pending");

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        actions={
          <Button
            className="h-10 gap-2 rounded-xl"
            onClick={() => void load()}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
        description="Real-time safety overview and emergency information for your ward."
        title="Safety Summary"
      />
      <Message value={message} />
      {loading ? <LoadingRows /> : null}

      {dashboard ? (
        <>
          <div className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
            <SectionCard title="Resident Safety Overview">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <InitialsAvatar name={residentName} size="lg" tone="guardian" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-foreground">{residentName}</p>
                    <SoftBadge tone={safetyTone}>{safetyStatus}</SoftBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {dashboard.hostel?.name ?? "Hostel"} · Guardian view only
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Relation: {dashboard.guardian.relation} · {dashboard.guardian.phone}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                    Current Status
                  </div>
                  <p className="mt-2 text-base font-bold text-foreground">
                    {safetyStatus}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Marked by hostel
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Siren className="size-3.5 text-role-platform" />
                    Emergency Status
                  </div>
                  <p className="mt-2 text-base font-bold text-foreground">Normal</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    No active alerts
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Clock3 className="size-3.5 text-role-guardian" />
                    Last Update
                  </div>
                  <p className="mt-2 text-base font-bold text-foreground">
                    {dashboard.safety?.checkedAt
                      ? new Date(dashboard.safety.checkedAt).toLocaleString()
                      : "Not verified"}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    From hostel system
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-semibold">No GPS Tracking. No Location History.</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    We do not track or share live location. Status is updated only by
                    hostel staff.
                  </p>
                </div>
              </div>
            </SectionCard>

            <div className="space-y-5">
              <SectionCard title="Warden / Hostel In-charge">
                <div className="flex items-center gap-3">
                  <InitialsAvatar
                    name={dashboard.hostel?.name ?? "Warden"}
                    size="md"
                    tone="guardian"
                  />
                  <div>
                    <p className="font-semibold text-foreground">
                      {dashboard.hostel?.name ?? "Hostel Office"}
                    </p>
                    <p className="text-xs text-muted-foreground">Hostel administration</p>
                    <SoftBadge className="mt-1" tone="green">
                      On duty · Available
                    </SoftBadge>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <RoleButton
                    className="w-full"
                    tone="guardian"
                    type="button"
                    variant="soft"
                  >
                    <Phone className="size-4" />
                    Call
                  </RoleButton>
                  <Button className="h-10 rounded-xl" type="button" variant="outline">
                    <MessageSquare className="size-4" />
                    Message
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Hostel Emergency Contact">
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900 dark:bg-rose-950/20">
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-rose-600" />
                    <p className="font-semibold text-foreground">
                      {dashboard.hostel?.name ?? "Hostel"}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    24/7 Emergency Helpline
                  </p>
                  <p className="mt-3 text-2xl font-bold text-rose-600">Contact Hostel</p>
                  <RoleButton
                    className="mt-4 w-full bg-rose-600 hover:bg-rose-600/90"
                    tone="guardian"
                  >
                    <Phone className="size-4" />
                    Call Emergency
                  </RoleButton>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  For critical emergencies, contact the hostel immediately.
                </p>
              </SectionCard>
            </div>
          </div>

          <SectionCard
            actions={
              <span className="text-xs font-semibold text-role-guardian">View all</span>
            }
            title="Guardian-Visible Notices"
          >
            {dashboard.notices.length === 0 ? (
              <EmptyInline label="No safety-related notices." />
            ) : (
              <div className="space-y-2">
                {dashboard.notices.map((notice) => (
                  <div
                    className="flex items-start gap-3 rounded-xl border border-border/70 px-3 py-3"
                    key={notice.id}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-role-guardian-soft text-role-guardian">
                      {notice.isUrgent ? (
                        <Bell className="size-4" />
                      ) : (
                        <Info className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {notice.title}
                        </p>
                        {notice.isUrgent ? (
                          <SoftBadge tone="rose">Urgent</SoftBadge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {notice.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="flex flex-col gap-3 rounded-xl border border-role-guardian/25 bg-role-guardian-soft/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <ShieldCheck className="size-4 text-role-guardian" />
              In case of any emergency, contact the warden or hostel immediately.
            </div>
            <Button
              className="h-9 rounded-xl border-role-guardian/30"
              type="button"
              variant="outline"
            >
              How We Ensure Safety
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
});
