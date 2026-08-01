"use client";

import { MapPinned } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import {
  EmptyState,
  LoadingRows,
  Panel,
  StatusBadge,
} from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";
import { Message, PageHeader } from "./daily-operations-shared";

const ATTENDANCE_ENDPOINT = "/api/v1/hostel-admin/attendance";
const ALERTS_ENDPOINT = "/api/v1/hostel-admin/attendance/alerts";

type Zone = "INSIDE" | "NEARBY" | "OUTSIDE" | "UNKNOWN";

type AttendanceRow = {
  resident: { fullName: string; id: string; roomType: string };
  zone: Zone;
};

type AttendanceAlert = {
  consecutiveDays: number;
  id: string;
  lastSeenAt?: string;
  residentName: string;
  resolutionNote: string;
  status: string;
};

/** Zone → colour. Matches the calendar key in the resident view. */
const ZONE_STYLES: Record<Zone, string> = {
  INSIDE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  NEARBY: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  OUTSIDE: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  UNKNOWN: "bg-muted text-muted-foreground",
};

const ZONE_ORDER: Zone[] = ["INSIDE", "NEARBY", "OUTSIDE", "UNKNOWN"];

export const HostelAdminAttendancePageContent = memo(
  function HostelAdminAttendancePageContent() {
    const [actionMessage, setActionMessage] = useState("");
    const invalidate = useInvalidateResources();
    const attendance = usePortalResource<{
      summary: Record<string, number>;
      today: AttendanceRow[];
    }>(ATTENDANCE_ENDPOINT, { errorMessage: "Could not load attendance." });
    const alerts = usePortalResource<{ alerts: AttendanceAlert[] }>(ALERTS_ENDPOINT, {
      errorMessage: "Could not load attendance alerts.",
    });

    const rows = useMemo(() => attendance.data?.today ?? [], [attendance.data]);
    const summary = attendance.data?.summary ?? {};
    const openAlerts = useMemo(
      () => (alerts.data?.alerts ?? []).filter((alert) => alert.status === "OPEN"),
      [alerts.data],
    );

    const override = useCallback(
      async (residentId: string) => {
        const zone = window
          .prompt("Set zone for today (INSIDE, NEARBY, OUTSIDE, UNKNOWN)")
          ?.trim()
          .toUpperCase();

        if (!zone || !ZONE_ORDER.includes(zone as Zone)) {
          return;
        }

        // The reason is not optional — an override without one is a silent edit
        // of a safety record.
        const reason = window.prompt("Why are you overriding this? (required)")?.trim();

        if (!reason) {
          setActionMessage("An override needs a reason.");

          return;
        }

        try {
          await browserApi(`${ATTENDANCE_ENDPOINT}/${residentId}/override`, {
            body: JSON.stringify({
              day: new Date().toISOString(),
              reason,
              zone,
            }),
            method: "PATCH",
          });
          setActionMessage("Attendance overridden.");
          invalidate(ATTENDANCE_ENDPOINT);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not override attendance.",
          );
        }
      },
      [invalidate],
    );

    const resolveAlert = useCallback(
      async (alertId: string) => {
        const note = window.prompt("Resolution note (optional)")?.trim();

        try {
          await browserApi(`${ALERTS_ENDPOINT}/${alertId}/resolve`, {
            body: JSON.stringify(note ? { note } : {}),
            method: "PATCH",
          });
          setActionMessage("Alert resolved.");
          invalidate(ALERTS_ENDPOINT);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not resolve the alert.",
          );
        }
      },
      [invalidate],
    );

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Where residents are today, by zone. Exact locations are never stored."
          icon={MapPinned}
          title="Attendance"
        />
        <Message value={actionMessage || attendance.message} />

        <div className="grid gap-3 sm:grid-cols-4">
          {ZONE_ORDER.map((zone) => (
            <div
              className="rounded-lg border border-border bg-surface p-4"
              key={zone}
            >
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {zone}
              </p>
              <p className="mt-1 text-3xl font-extrabold text-foreground">
                {summary[zone] ?? 0}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Panel title="Today">
            {attendance.state === "loading" ? <LoadingRows /> : null}
            {attendance.state === "ready" && rows.length === 0 ? (
              <EmptyState label="No active residents to track." />
            ) : null}
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  key={row.resident.id}
                >
                  <div>
                    <p className="font-semibold text-foreground">
                      {row.resident.fullName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.resident.roomType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-bold",
                        ZONE_STYLES[row.zone],
                      )}
                    >
                      {row.zone}
                    </span>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground"
                      onClick={() => void override(row.resident.id)}
                      type="button"
                    >
                      Override
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Absence Alerts">
            {alerts.state === "loading" ? <LoadingRows /> : null}
            {alerts.state === "ready" && openAlerts.length === 0 ? (
              <EmptyState label="No open absence alerts." />
            ) : null}
            <div className="space-y-3">
              {openAlerts.map((alert) => (
                <div className="rounded-lg border border-border p-4" key={alert.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {alert.residentName}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Away {alert.consecutiveDays} consecutive days
                      </p>
                    </div>
                    <StatusBadge>{alert.status}</StatusBadge>
                  </div>
                  <button
                    className="mt-3 rounded-md bg-role-admin px-3 py-2 text-sm font-semibold text-white"
                    onClick={() => void resolveAlert(alert.id)}
                    type="button"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    );
  },
);
