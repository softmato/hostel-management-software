"use client";

import React, { useCallback, useMemo, useState, type FormEvent } from "react";
import { Gift } from "lucide-react";
import { EmptyState, Panel, StatusBadge } from "@/app/_components/shared-ui";
import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import {
  Message,
  PageHeader,
  optionalField,
  optionalNumber,
  type Referral,
} from "./portal-shared";

export const HostelAdminReferralsPageContent = React.memo(
  function HostelAdminReferralsPageContent() {
    const [actionMessage, setActionMessage] = useState("");
    const invalidate = useInvalidateResources();
    const referralsResource = usePortalResource<{ referrals: Referral[] }>(
      hostelAdminEndpoints.referrals,
      { errorMessage: "Could not load referrals." },
    );

    const referrals = useMemo(
      () => referralsResource.data?.referrals ?? [],
      [referralsResource.data],
    );
    const message = actionMessage || referralsResource.message;

    const confirm = useCallback(
      async (event: FormEvent<HTMLFormElement>, referralId: string) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        try {
          await browserApi(`${hostelAdminEndpoints.referrals}/${referralId}/confirm`, {
            body: JSON.stringify({
              rewardAmount: optionalNumber(form, "rewardAmount"),
              rewardNotes: optionalField(form, "rewardNotes"),
            }),
            method: "PATCH",
          });
          setActionMessage("Referral confirmed.");
          invalidate(hostelAdminEndpoints.referrals);
        } catch (error) {
          setActionMessage(
            error instanceof Error ? error.message : "Could not confirm referral.",
          );
        }
      },
      [invalidate],
    );

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Confirm referred residents who joined and track rewards."
          icon={Gift}
          title="Referrals"
        />
        <Message value={message} />
        <Panel>
          {referrals.length === 0 ? <EmptyState label="No referrals." /> : null}
          <div className="grid gap-3 xl:grid-cols-2">
            {referrals.map((referral) => (
              <div className="rounded-lg border border-border p-4" key={referral.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{referral.name}</p>
                    <p className="text-sm text-muted-foreground">{referral.phone}</p>
                  </div>
                  <StatusBadge>{referral.status}</StatusBadge>
                </div>
                <BusyForm
                  className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={(event) => confirm(event, referral.id)}
                >
                  <input
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                    name="rewardAmount"
                    placeholder="Reward amount"
                    type="number"
                  />
                  <input
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                    name="rewardNotes"
                    placeholder="Reward notes"
                  />
                  <SubmitButton className="h-10 rounded-md bg-role-admin px-3 text-sm font-semibold text-white">
                    Confirm
                  </SubmitButton>
                </BusyForm>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  },
);
