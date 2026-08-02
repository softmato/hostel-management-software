"use client";

import { SlidersHorizontal } from "lucide-react";
import { memo, useCallback, useState, type FormEvent } from "react";

import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  Select,
} from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { usePortalResource } from "@/lib/portal-query";
import { field } from "./portal-shared";

type OperationsConfig = {
  complaintSlaHours: number;
  foodReadyCooldownMinutes: number;
  maxAttendanceRetentionDays: number;
  maxInsideZoneRadiusMeters: number;
  maxNearbyZoneRadiusMeters: number;
  paymentReminderDaysBefore: number;
  qrActivationExpiryDays: number;
  receiptNumberPrefix: string;
  sendComplaintEmails: boolean;
  sendNoticeEmails: boolean;
  sendPaymentEmails: boolean;
};

const OPERATIONS_ENDPOINT = "/api/v1/platform/operations-config";

/**
 * Platform defaults and the ceilings hostels tune within (ARCHITECTURE.md §5).
 * Deliberately separate from Website Config: this changes how activation,
 * payments, complaints and attendance behave, not what the public site says.
 */
export const PlatformOperationsPanel = memo(function PlatformOperationsPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const resource = usePortalResource<{ config: OperationsConfig }>(OPERATIONS_ENDPOINT, {
    errorMessage: "Could not load operations configuration.",
  });
  const config = resource.data?.config ?? null;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      setBusy(true);
      setMessage("");

      try {
        await browserApi(OPERATIONS_ENDPOINT, {
          body: JSON.stringify({
            complaintSlaHours: Number(field(form, "complaintSlaHours")),
            foodReadyCooldownMinutes: Number(field(form, "foodReadyCooldownMinutes")),
            maxAttendanceRetentionDays: Number(field(form, "maxAttendanceRetentionDays")),
            maxInsideZoneRadiusMeters: Number(field(form, "maxInsideZoneRadiusMeters")),
            maxNearbyZoneRadiusMeters: Number(field(form, "maxNearbyZoneRadiusMeters")),
            paymentReminderDaysBefore: Number(field(form, "paymentReminderDaysBefore")),
            qrActivationExpiryDays: Number(field(form, "qrActivationExpiryDays")),
            receiptNumberPrefix: field(form, "receiptNumberPrefix"),
            sendComplaintEmails: field(form, "sendComplaintEmails") === "true",
            sendNoticeEmails: field(form, "sendNoticeEmails") === "true",
            sendPaymentEmails: field(form, "sendPaymentEmails") === "true",
          }),
          method: "PUT",
        });

        setMessage("Operations configuration saved.");
        await resource.refreshAsync();
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not save the configuration.",
        );
      } finally {
        setBusy(false);
      }
    },
    [resource],
  );

  return (
    <Panel title="Operations configuration">
      {resource.state === "loading" ? <LoadingRows /> : null}
      {resource.state === "error" ? (
        <EmptyState label="Operations configuration could not be loaded." />
      ) : null}

      {config ? (
        <form className="grid gap-4" key={JSON.stringify(config)} onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              defaultValue={config.qrActivationExpiryDays}
              hint="Days a resident activation code stays valid."
              label="QR activation expiry (days)"
              min="1"
              name="qrActivationExpiryDays"
              required
              type="number"
            />
            <Input
              defaultValue={config.paymentReminderDaysBefore}
              hint="How early the reminder cron emails a due payment."
              label="Payment reminder lead (days)"
              min="0"
              name="paymentReminderDaysBefore"
              required
              type="number"
            />
            <Input
              defaultValue={config.complaintSlaHours}
              hint="Response window every complaint is measured against."
              label="Complaint SLA (hours)"
              min="1"
              name="complaintSlaHours"
              required
              type="number"
            />
            <Input
              defaultValue={config.receiptNumberPrefix}
              hint="Leading text on generated receipt numbers."
              label="Receipt prefix"
              name="receiptNumberPrefix"
              required
            />
            <Input
              defaultValue={config.foodReadyCooldownMinutes}
              hint="Blast-radius limit on a shared cook login."
              label="Food-ready cooldown (minutes)"
              min="0"
              name="foodReadyCooldownMinutes"
              required
              type="number"
            />
          </div>

          <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">
              Limits hostels tune within
            </legend>
            <Input
              defaultValue={config.maxInsideZoneRadiusMeters}
              hint="Ceiling on a hostel's inside-zone radius."
              label="Max inside radius (m)"
              min="10"
              name="maxInsideZoneRadiusMeters"
              required
              type="number"
            />
            <Input
              defaultValue={config.maxNearbyZoneRadiusMeters}
              hint="Ceiling on a hostel's nearby-zone radius."
              label="Max nearby radius (m)"
              min="20"
              name="maxNearbyZoneRadiusMeters"
              required
              type="number"
            />
            <Input
              defaultValue={config.maxAttendanceRetentionDays}
              hint="Longest a hostel may keep raw attendance logs."
              label="Max attendance retention (days)"
              min="30"
              name="maxAttendanceRetentionDays"
              required
              type="number"
            />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              defaultValue={String(config.sendPaymentEmails)}
              label="Payment emails"
              name="sendPaymentEmails"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </Select>
            <Select
              defaultValue={String(config.sendNoticeEmails)}
              label="Notice emails"
              name="sendNoticeEmails"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </Select>
            <Select
              defaultValue={String(config.sendComplaintEmails)}
              label="Complaint emails"
              name="sendComplaintEmails"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {message}
            </p>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-role-platform px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-platform disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              {busy ? "Saving…" : "Save configuration"}
            </button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
});
