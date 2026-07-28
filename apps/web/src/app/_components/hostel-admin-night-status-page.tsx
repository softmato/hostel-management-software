"use client";

import { ShieldCheck } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { type NightStatusRow, Message, PageHeader } from "./daily-operations-shared";
import { EmptyState, LoadingRows, Panel, StatusBadge } from "@/app/_components/shared-ui";

export const HostelAdminNightStatusPage = memo(function HostelAdminNightStatusPage() {
  const [actionMessage, setActionMessage] = useState("");
  const invalidate = useInvalidateResources();
  const statusResource = usePortalResource<{ statuses: NightStatusRow[] }>(
    hostelAdminEndpoints.nightStatus,
    { errorMessage: "Could not load statuses." },
  );

  const rows = useMemo(
    () => statusResource.data?.statuses ?? [],
    [statusResource.data],
  );
  const state = statusResource.state;
  const message = actionMessage || statusResource.message;

  const override = useCallback(
    async (residentId: string, statusValue: string) => {
      const reason = window.prompt("Override reason")?.trim();

      if (!reason) {
        return;
      }

      try {
        await browserApi(
          `${hostelAdminEndpoints.nightStatus}/${residentId}/override`,
          {
            body: JSON.stringify({ reason, status: statusValue }),
            method: "PATCH",
          },
        );
        setActionMessage("Status overridden.");
        invalidate(hostelAdminEndpoints.nightStatus);
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not override status.",
        );
      }
    },
    [invalidate],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PageHeader
        description="Status-only safety summary for residents in this hostel."
        icon={ShieldCheck}
        title="Night Status"
      />
      <Message value={message} />
      <Panel>
        {state === "loading" ? <LoadingRows /> : null}
        {state === "error" ? (
          <EmptyState label="Night status could not be loaded." />
        ) : null}
        {state === "ready" && rows.length === 0 ? (
          <EmptyState label="No residents." />
        ) : null}
        <div className="space-y-3">
          {rows.map((row) => (
            <div className="rounded-lg border border-border p-4" key={row.resident.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    {row.resident.firstName} {row.resident.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{row.resident.phone}</p>
                </div>
                <StatusBadge>{row.status.status}</StatusBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {["INSIDE_HOSTEL", "OUTSIDE_HOSTEL", "MARKED_SAFE"].map((item) => (
                  <button
                    className="rounded-md border border-role-admin px-3 py-2 text-sm font-semibold text-role-admin"
                    key={item}
                    onClick={() => void override(row.resident.id, item)}
                    type="button"
                  >
                    {item.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
});
