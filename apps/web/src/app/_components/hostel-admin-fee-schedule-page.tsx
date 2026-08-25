"use client";

import { CalendarClock, Coins, Layers } from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  currency,
  EmptyState,
  Input,
  LoadingRows,
  Panel,
} from "@/app/_components/shared-ui";
import {
  DataTable,
  SoftBadge,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Th,
} from "@/app/_components/portal-dashboard-ui";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { usePortalResource } from "@/lib/portal-query";
import { BED_TYPE_LABELS, BED_TYPES, type BedType } from "@hostel/shared/types/bed-type";
import { Message, PageHeader, field } from "./portal-shared";

/**
 * The rate card editor (target §11.9, plan item 3.2).
 *
 * **This replaces the old Fee Plans page** (deviation §3.4, D2). That page read
 * `roomConfigurations[].monthlyRent` and called it a fee plan, so a hostel had
 * two rate cards on two screens — which is how a hostel bills the wrong amount.
 * `roomConfigurations[].monthlyRent` survives as the *public listing price*;
 * what is edited here is the *billing price*, and they are allowed to differ.
 *
 * **A schedule is never edited.** Saving closes the current card the day before
 * the new one starts and opens a successor, so an invoice issued in March can
 * still be explained in September.
 */

type Rate = { bedType: BedType; monthlyAmount: number };

type FeeSchedule = {
  _id: string;
  admissionFee?: number;
  referralAdmissionDiscount?: number;
  depositAmount?: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  rates: Rate[];
};

const SCHEDULES_ENDPOINT = hostelAdminEndpoints.feeSchedules;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

/** First of next month — the date a rate change almost always takes effect. */
function defaultEffectiveFrom() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return next.toISOString().slice(0, 10);
}

export const HostelAdminFeeSchedulePageContent = memo(
  function HostelAdminFeeSchedulePageContent() {
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);

    const resource = usePortalResource<{ schedules: FeeSchedule[] }>(
      SCHEDULES_ENDPOINT,
      { errorMessage: "Could not load the rate card." },
    );

    const schedules = useMemo(
      () => resource.data?.schedules ?? [],
      [resource.data],
    );
    const open = useMemo(
      () => schedules.find((schedule) => schedule.effectiveTo === null) ?? null,
      [schedules],
    );

    /** Rate for a bed type on the open card, or blank so nothing is invented. */
    const rateFor = useCallback(
      (bedType: BedType) =>
        open?.rates.find((rate) => rate.bedType === bedType)?.monthlyAmount ?? "",
      [open],
    );

    const save = useCallback(
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        // A blank box means "this hostel does not offer that bed type", not
        // "free". Sending a zero would price it at nothing; omitting it makes
        // billing fail loudly with BED_TYPE_NOT_PRICED, which is the rule.
        const rates = BED_TYPES.map((bedType) => ({
          bedType,
          monthlyAmount: field(form, `rate-${bedType}`),
        }))
          .filter((entry) => entry.monthlyAmount !== "")
          .map((entry) => ({
            bedType: entry.bedType,
            monthlyAmount: Number(entry.monthlyAmount),
          }));

        if (rates.length === 0) {
          setMessage("Set a rate for at least one bed type.");
          return;
        }

        setSaving(true);
        setMessage("");

        try {
          await browserApi(SCHEDULES_ENDPOINT, {
            body: JSON.stringify({
              admissionFee: field(form, "admissionFee")
                ? Number(field(form, "admissionFee"))
                : undefined,
              depositAmount: field(form, "depositAmount")
                ? Number(field(form, "depositAmount"))
                : undefined,
              effectiveFrom: field(form, "effectiveFrom"),
              rates,
              referralAdmissionDiscount: field(form, "referralAdmissionDiscount")
                ? Number(field(form, "referralAdmissionDiscount"))
                : undefined,
            }),
            method: "POST",
          });

          setMessage(
            "New rate card saved. The previous one is closed and stays readable below.",
          );
          await resource.refreshAsync();
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Could not save the rate card.",
          );
        } finally {
          setSaving(false);
        }
      },
      [resource],
    );

    return (
      <div className="mx-auto max-w-[1100px] space-y-6">
        <PageHeader
          description="What this hostel charges per bed type. Every invoice is computed from the card that was open on its billing date."
          icon={Coins}
          title="Fee Schedule"
        />
        <Message value={message} />

        {resource.state === "loading" ? <LoadingRows /> : null}
        {resource.state === "error" ? (
          <EmptyState label="The rate card could not be loaded." />
        ) : null}

        {resource.state === "ready" ? (
          <>
            {open ? null : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold">This hostel has no open rate card.</p>
                <p className="mt-1 leading-5">
                  Billing will fail for every resident until one exists — deliberately,
                  because a guessed rate is worse than a run that stops and says why.
                </p>
              </div>
            )}

            <Panel
              title={open ? "Change the rate card" : "Create the first rate card"}
            >
              <form className="grid gap-4" key={open?._id ?? "new"} onSubmit={save}>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Layers aria-hidden="true" className="size-4" />
                  Leave a bed type blank if you do not offer it. A blank is not free —
                  billing stops and names the resident it could not price.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {BED_TYPES.map((bedType) => (
                    <Input
                      defaultValue={rateFor(bedType)}
                      key={bedType}
                      label={`${BED_TYPE_LABELS[bedType]} (NPR / month)`}
                      min="0"
                      name={`rate-${bedType}`}
                      step="1"
                      type="number"
                    />
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Input
                    defaultValue={open?.admissionFee ?? ""}
                    hint="One-time charge at move-in. Blank if you do not levy one."
                    label="Admission fee (NPR)"
                    min="0"
                    name="admissionFee"
                    type="number"
                  />
                  <Input
                    defaultValue={open?.referralAdmissionDiscount ?? ""}
                    hint="Comes off the admission fee when someone arrives on a resident's referral code. Never off the rent."
                    label="Referral discount (NPR)"
                    min="0"
                    name="referralAdmissionDiscount"
                    type="number"
                  />
                  <Input
                    defaultValue={open?.depositAmount ?? ""}
                    hint="Refundable security deposit."
                    label="Deposit (NPR)"
                    min="0"
                    name="depositAmount"
                    type="number"
                  />
                  <Input
                    defaultValue={defaultEffectiveFrom()}
                    hint="The current card closes the day before this."
                    label="Effective from"
                    name="effectiveFrom"
                    required
                    type="date"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    className="rounded-md bg-role-admin px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    disabled={saving}
                    type="submit"
                  >
                    {saving ? "Saving…" : "Save new rate card"}
                  </button>
                </div>
              </form>
            </Panel>

            <Panel title="Rate card history">
              {schedules.length === 0 ? (
                <EmptyState label="No rate card has been set for this hostel yet." />
              ) : (
                <DataTable className="min-w-[680px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Effective</Th>
                      {BED_TYPES.map((bedType) => (
                        <Th align="right" key={bedType}>
                          {BED_TYPE_LABELS[bedType]}
                        </Th>
                      ))}
                      <Th align="right">Deposit</Th>
                      <Th>Status</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((schedule) => (
                      <TableRow key={schedule._id}>
                        <TableCell className="whitespace-nowrap font-semibold text-foreground">
                          <span className="flex items-center gap-1.5">
                            <CalendarClock
                              aria-hidden="true"
                              className="size-3.5 text-muted-foreground"
                            />
                            {formatDate(schedule.effectiveFrom)} →{" "}
                            {formatDate(schedule.effectiveTo)}
                          </span>
                        </TableCell>
                        {BED_TYPES.map((bedType) => {
                          const rate = schedule.rates.find(
                            (entry) => entry.bedType === bedType,
                          );

                          return (
                            <TableCell className="text-right" key={bedType}>
                              {rate ? (
                                currency(rate.monthlyAmount)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right">
                          {schedule.depositAmount
                            ? currency(schedule.depositAmount)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {schedule.effectiveTo === null ? (
                            <SoftBadge tone="green">Current</SoftBadge>
                          ) : (
                            <SoftBadge tone="slate">Closed</SoftBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              )}
            </Panel>
          </>
        ) : null}
      </div>
    );
  },
);
