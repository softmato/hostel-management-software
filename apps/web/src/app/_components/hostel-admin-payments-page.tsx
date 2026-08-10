"use client";

import {
  AlertTriangle,
  Check,
  Clock3,
  CreditCard,
  Download,
  Plus,
  ReceiptText,
  WalletCards,
  X,
} from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  currency,
  EmptyState,
  Input as FormInput,
  LoadingRows,
  Select as FormSelect,
  TextArea,
} from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { browserApi } from "@/lib/browser-api";
import { CLAIM_REJECTION_REASONS } from "@/modules/finance/claim.validation";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import {
  combineResources,
  useInvalidateResources,
  usePortalResource,
} from "@/lib/portal-query";

import {
  field,
  optionalField,
  type Payment,
  type PaymentProof,
  type Resident,
} from "./hostel-admin-shared";
import {
  DataTable,
  EmptyInline,
  InitialsAvatar,
  MetricCard,
  PortalPageHeader,
  RoleButton,
  SearchField,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./portal-dashboard-ui";

type MatrixRow = {
  displayStatus:
    | "PAID"
    | "PARTIAL"
    | "UNPAID"
    | "OVERDUE"
    | "PENDING_PROOF"
    | "NOT_BILLED";
  payment: Payment | null;
  resident: Resident & { fullName: string; moveInDate: string };
};

type MatrixTotals = {
  collected: number;
  due: number;
  notBilled: number;
  overdue: number;
  paid: number;
  partial: number;
  unpaid: number;
};

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const HostelAdminPaymentsPage = memo(function HostelAdminPaymentsPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  /** Which claim's rejection-reason picker is open. "" means none (item 3.5). */
  const [rejectingId, setRejectingId] = useState("");
  const [approvingAll, setApprovingAll] = useState(false);
  const invalidate = useInvalidateResources();

  const errorMessage = "Could not load payments.";
  const residentsResource = usePortalResource<{ residents: Resident[] }>(
    hostelAdminEndpoints.residents,
    { errorMessage },
  );
  // Keyed by month, so stepping back to a month already viewed paints from
  // cache instead of blanking the matrix.
  const matrixResource = usePortalResource<{
    month: string;
    rows: MatrixRow[];
    totals: MatrixTotals;
  }>(hostelAdminEndpoints.paymentsMatrix(month), { errorMessage });
  // Claims awaiting a decision. Since item 2.8 a "proof" is a PENDING
  // `PaymentEvent`, so the queue is the events endpoint rather than a second
  // list hanging off the payments response.
  const paymentsResource = usePortalResource<{ events: PaymentProof[] }>(
    hostelAdminEndpoints.paymentClaims,
    { errorMessage },
  );

  const residents = useMemo(
    () => residentsResource.data?.residents ?? [],
    [residentsResource.data],
  );
  const rows = useMemo(() => matrixResource.data?.rows ?? [], [matrixResource.data]);
  const totals = matrixResource.data?.totals ?? null;
  const proofs = useMemo(
    () => paymentsResource.data?.events ?? [],
    [paymentsResource.data],
  );
  // Not sliced: `Approve all` must sweep exactly what the owner was shown, and
  // a hidden seventh row is the difference between a count they confirmed and
  // one they did not.
  const pendingProofs = useMemo(
    () => proofs.filter((proof) => proof.status === "PENDING"),
    [proofs],
  );
  const combined = combineResources(residentsResource, matrixResource, paymentsResource);
  const state = combined.state;
  const message = actionMessage || combined.message;

  const residentById = useMemo(
    () => new Map(residents.map((resident) => [resident.id, resident])),
    [residents],
  );

  // Every mutation on this page moves both the matrix and the proof list.
  const refreshPayments = useCallback(() => {
    invalidate(
      hostelAdminEndpoints.paymentsMatrixAll,
      hostelAdminEndpoints.transactions,
      hostelAdminEndpoints.residents,
    );
  }, [invalidate]);

  const handleCreatePayment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

      try {
        await browserApi(hostelAdminEndpoints.transactions, {
          body: JSON.stringify({
            dueAmount: Number(field(form, "dueAmount")),
            dueDate: field(form, "dueDate"),
            month: field(form, "month"),
            residentId: field(form, "residentId"),
            remarks: optionalField(form, "remarks"),
          }),
          method: "POST",
        });
        formElement.reset();
        setShowCreate(false);
        setActionMessage("Payment record created.");
        refreshPayments();
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not create payment.",
        );
      }
    },
    [refreshPayments],
  );

  const handleFeeRun = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const monthlyFee = optionalField(form, "monthlyFee");

      try {
        if (monthlyFee) {
          await browserApi(hostelAdminEndpoints.residentFees, {
            body: JSON.stringify({ monthlyFee: Number(monthlyFee) }),
            method: "PATCH",
          });
        }

        const result = await browserApi<{
          billed: { residentId: string }[];
          failures: { errorCode: string; residentId: string }[];
          skipped: { reason: string; residentId: string }[];
        }>(hostelAdminEndpoints.billingRuns, {
          body: JSON.stringify({
            dueDate: field(form, "dueDate") || undefined,
            period: field(form, "month"),
          }),
          method: "POST",
        });

        // Failures are surfaced, never swallowed: a resident who cannot be
        // priced is reported rather than billed zero (P8).
        setActionMessage(
          `${result.billed.length} invoice(s) issued, ${result.skipped.length} skipped` +
            (result.failures.length > 0
              ? `, ${result.failures.length} could not be priced — check their room type and the fee schedule.`
              : "."),
        );
        refreshPayments();
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not run the monthly fee job.",
        );
      }
    },
    [refreshPayments],
  );

  const reviewProof = useCallback(
    async (proofId: string, action: "approve" | "reject", rejectionReason?: string) => {
      // A fixed reason list, not `window.prompt` (current §5.2): the resident
      // gets a sentence they can act on, the reasons become countable, and
      // nobody types an accusation into a permanent record.
      if (action === "reject" && !rejectionReason) {
        return;
      }

      try {
        await browserApi(
          `${hostelAdminEndpoints.paymentClaims}/${proofId}/${action}`,
          {
            body: JSON.stringify(action === "reject" ? { rejectionReason } : {}),
            method: "POST",
          },
        );
        setActionMessage(action === "approve" ? "Proof approved." : "Proof rejected.");
        setRejectingId("");
        refreshPayments();
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not review proof.",
        );
      }
    },
    [refreshPayments],
  );

  /**
   * `Approve all` (target §11.4, item 3.5).
   *
   * Sweeps only all-green rows and confirms with the count and the total first —
   * an owner about to settle eleven payments at once should be told how much
   * money that is before, not after. The server re-derives which rows are green,
   * so a row that went amber since the render is skipped and reported.
   */
  const approveAll = useCallback(async () => {
    const green = pendingProofs.filter((proof) => proof.allGreen);

    if (green.length === 0) {
      setActionMessage("No claims have passed every check.");
      return;
    }

    const total = green.reduce((sum, proof) => sum + proof.amount, 0);

    if (
      !window.confirm(
        `Approve ${green.length} payment(s) totalling ${currency(total)}? Each resident gets a receipt.`,
      )
    ) {
      return;
    }

    setApprovingAll(true);

    try {
      const result = await browserApi<{
        data: { approved: string[]; skipped: { reason: string }[] };
      }>(`${hostelAdminEndpoints.paymentClaims}/bulk-approve`, {
        body: JSON.stringify({ eventIds: green.map((proof) => proof.eventId) }),
        method: "POST",
      });

      const approved = result?.data?.approved?.length ?? 0;
      const skipped = result?.data?.skipped?.length ?? 0;

      setActionMessage(
        `${approved} payment(s) approved` +
          (skipped > 0 ? `, ${skipped} left for review.` : "."),
      );
      refreshPayments();
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Could not approve the claims.",
      );
    } finally {
      setApprovingAll(false);
    }
  }, [pendingProofs, refreshPayments]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "ALL") {
        const matchesFilter =
          filter === "UNPAID"
            ? ["UNPAID", "PENDING_PROOF", "NOT_BILLED"].includes(row.displayStatus)
            : row.displayStatus === filter;
        if (!matchesFilter) {
          return false;
        }
      }
      if (!query) {
        return true;
      }
      return row.resident.fullName.toLowerCase().includes(query);
    });
  }, [filter, rows, search]);

  const stats = useMemo(
    () => ({
      dueAmount: totals ? Math.max(totals.due - totals.collected, 0) : 0,
      monthlyCollection: totals?.collected ?? 0,
      notBilled: totals?.notBilled ?? 0,
      overdue: totals?.overdue ?? 0,
      paid: totals?.paid ?? 0,
      partial: totals?.partial ?? 0,
      pendingProofs: proofs.filter((p) => p.status === "PENDING").length,
      unpaid: totals?.unpaid ?? 0,
    }),
    [proofs, totals],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        actions={
          <>
            <Button className="h-10 gap-2 rounded-xl" type="button" variant="outline">
              <Download className="size-4" />
              Export
            </Button>
            <RoleButton
              onClick={() => setShowCreate((value) => !value)}
              tone="admin"
              type="button"
            >
              <Plus className="size-4" />
              Record Payment
            </RoleButton>
          </>
        }
        description="Manage hostel fee collections, payments and approvals."
        title="Payments"
      />

      {message ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label="Monthly Collection"
          tone="blue"
          trend="Paid amount this filter"
          value={currency(stats.monthlyCollection)}
        />
        <MetricCard
          icon={ReceiptText}
          label="Due Amount"
          tone="cyan"
          trend={`${stats.unpaid + stats.overdue + stats.partial} open records`}
          value={currency(stats.dueAmount)}
        />
        <MetricCard
          icon={Clock3}
          label="Pending Proofs"
          tone="amber"
          trend="Awaiting approval"
          value={String(stats.pendingProofs)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Overdue Residents"
          tone="rose"
          trendDown
          trend="Needs follow-up"
          value={String(stats.overdue)}
        />
      </div>

      {showCreate ? (
        <SectionCard
          actions={
            <Button
              className="size-8"
              onClick={() => setShowCreate(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          }
          title="Create Payment Record"
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreatePayment}>
            <FormSelect label="Resident" name="residentId" required>
              <option value="">Select resident</option>
              {residents.map((resident) => (
                <option key={resident.id} value={resident.id}>
                  {resident.firstName} {resident.lastName}
                </option>
              ))}
            </FormSelect>
            <FormInput label="Month" name="month" required type="month" />
            <FormInput label="Due amount" name="dueAmount" required type="number" />
            <FormInput label="Due date" name="dueDate" required type="date" />
            <div className="md:col-span-2">
              <TextArea label="Remarks" name="remarks" />
            </div>
            <div className="md:col-span-2">
              <RoleButton className="w-full sm:w-auto" tone="admin" type="submit">
                <CreditCard className="size-4" />
                Create Record
              </RoleButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard
        description="Creates this month's record for every active resident that does not have one yet. Residents keep their own monthly fee unless you set one here."
        title="Monthly Fee Run"
      >
        <form className="grid gap-3 md:grid-cols-4" onSubmit={handleFeeRun}>
          <FormInput label="Month" name="month" required type="month" />
          <FormInput label="Due date" name="dueDate" required type="date" />
          <FormInput
            label="Set fee for all (optional)"
            min="0"
            name="monthlyFee"
            type="number"
          />
          <div className="flex items-end">
            <RoleButton className="w-full" tone="admin" type="submit">
              <CreditCard className="size-4" />
              Generate Records
            </RoleButton>
          </div>
        </form>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <SectionCard>
          <Tabs onValueChange={setFilter} value={filter}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList
                className="h-auto flex-wrap rounded-none bg-transparent p-0"
                variant="line"
              >
                <TabsTrigger className="rounded-none px-3 pb-2" value="ALL">
                  All ({rows.length})
                </TabsTrigger>
                <TabsTrigger className="rounded-none px-3 pb-2" value="PAID">
                  Paid ({stats.paid})
                </TabsTrigger>
                <TabsTrigger className="rounded-none px-3 pb-2" value="UNPAID">
                  Unpaid ({stats.unpaid})
                </TabsTrigger>
                <TabsTrigger className="rounded-none px-3 pb-2" value="PARTIAL">
                  Partial ({stats.partial})
                </TabsTrigger>
                <TabsTrigger className="rounded-none px-3 pb-2" value="OVERDUE">
                  Overdue ({stats.overdue})
                </TabsTrigger>
              </TabsList>
              <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                Month
                <input
                  className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-role-admin"
                  onChange={(event) => setMonth(event.target.value || defaultMonth())}
                  type="month"
                  value={month}
                />
              </label>
            </div>

            <SearchField
              className="mb-4 max-w-none"
              onChange={setSearch}
              placeholder="Search by resident name, room no..."
              value={search}
            />

            <TabsContent className="mt-0" value={filter}>
              {state === "loading" ? <LoadingRows /> : null}
              {state === "error" ? (
                <EmptyState label="Payments could not be loaded." />
              ) : null}
              {state === "ready" && filteredRows.length === 0 ? (
                <EmptyInline label="No residents for this month." />
              ) : null}
              {state === "ready" && filteredRows.length > 0 ? (
                <DataTable className="min-w-[700px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Resident
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Due (NPR)
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Paid
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Due Date
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => {
                      const name = row.resident.fullName;
                      const movedInThisMonth = row.resident.moveInDate.startsWith(month);

                      return (
                        <TableRow key={row.resident.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <InitialsAvatar name={name} size="sm" tone="admin" />
                              <div>
                                <p className="font-semibold text-foreground">{name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {row.resident.phone}
                                  {movedInThisMonth
                                    ? ` · moved in ${new Date(row.resident.moveInDate).toLocaleDateString()} (pro-rated)`
                                    : ""}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.payment ? currency(row.payment.dueAmount) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.payment ? currency(row.payment.paidAmount) : "—"}
                          </TableCell>
                          <TableCell>
                            <SoftBadge
                              tone={
                                row.displayStatus === "NOT_BILLED"
                                  ? "slate"
                                  : statusToneFromLabel(row.displayStatus)
                              }
                            >
                              {row.displayStatus === "NOT_BILLED"
                                ? "NO FEE SET"
                                : row.displayStatus.replaceAll("_", " ")}
                            </SoftBadge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.payment
                              ? new Date(row.payment.dueDate).toLocaleDateString()
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </DataTable>
              ) : null}
            </TabsContent>
          </Tabs>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            actions={
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {pendingProofs.length} pending
                </span>
                {pendingProofs.some((proof) => proof.allGreen) ? (
                  <Button
                    className="h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90"
                    disabled={approvingAll}
                    onClick={() => void approveAll()}
                    size="sm"
                    type="button"
                  >
                    {approvingAll ? "Approving…" : "Approve all"}
                  </Button>
                ) : null}
              </div>
            }
            title={`Payment Proofs (${stats.pendingProofs})`}
          >
            {pendingProofs.length === 0 ? (
              <EmptyInline label="No proofs awaiting review." />
            ) : (
              <div className="space-y-3">
                {pendingProofs.map((proof) => {
                  const resident = residentById.get(proof.residentId);
                  const name = resident
                    ? `${resident.firstName} ${resident.lastName}`
                    : "Resident";

                  return (
                    <div
                      className="rounded-xl border border-border/70 bg-muted/10 p-3"
                      key={proof.eventId}
                    >
                      <div className="flex items-start gap-3">
                        {proof.evidenceAssetId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt="Payment proof"
                            className="size-12 rounded-lg object-cover"
                            src={`/api/v1/files/${proof.evidenceAssetId}/url?variant=THUMBNAIL`}
                          />
                        ) : (
                          <InitialsAvatar name={name} size="sm" tone="admin" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">{name}</p>
                          <p className="text-xs font-semibold text-foreground">
                            {currency(proof.amount)}
                            {proof.method ? ` · ${proof.method}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {proof.transactionCode ||
                              proof.referenceNote ||
                              "No txn code"}
                          </p>

                          {/* The checks a careful owner would run by eye. An
                              amber one never blocks this button — they can see
                              the screenshot and we cannot — it only keeps the
                              row out of `Approve all`. */}
                          {proof.checks?.length ? (
                            <ul className="mt-2 space-y-0.5">
                              {proof.checks.map((check) => (
                                <li
                                  className={`flex items-start gap-1.5 text-[11px] leading-4 ${
                                    check.ok
                                      ? "text-muted-foreground"
                                      : "font-semibold text-amber-700 dark:text-amber-400"
                                  }`}
                                  key={check.key}
                                >
                                  {check.ok ? (
                                    <Check className="mt-0.5 size-3 shrink-0" />
                                  ) : (
                                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                  )}
                                  {check.detail}
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {rejectingId === proof.eventId ? (
                            <div className="mt-2 space-y-2">
                              <FormSelect
                                label="Reason"
                                name={`reason-${proof.eventId}`}
                                onChange={(event) => {
                                  const code = event.target
                                    .value as keyof typeof CLAIM_REJECTION_REASONS;

                                  if (code) {
                                    void reviewProof(
                                      proof.eventId,
                                      "reject",
                                      CLAIM_REJECTION_REASONS[code],
                                    );
                                  }
                                }}
                              >
                                <option value="">Choose a reason…</option>
                                {Object.entries(CLAIM_REJECTION_REASONS).map(
                                  ([code, label]) => (
                                    <option key={code} value={code}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </FormSelect>
                              <Button
                                className="h-7 w-full rounded-lg"
                                onClick={() => setRejectingId("")}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : null}

                          <div className="mt-2 flex gap-2">
                            <Button
                              className="h-8 flex-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90"
                              onClick={() => void reviewProof(proof.eventId, "approve")}
                              size="sm"
                              type="button"
                            >
                              <Check className="size-3.5" />
                              Approve
                            </Button>
                            <Button
                              className="h-8 flex-1 rounded-lg"
                              onClick={() => setRejectingId(proof.eventId)}
                              size="sm"
                              type="button"
                              variant="destructive"
                            >
                              <X className="size-3.5" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
});
