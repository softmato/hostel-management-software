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
  const paymentsResource = usePortalResource<{
    payments: Payment[];
    proofs: PaymentProof[];
  }>(hostelAdminEndpoints.transactions, { errorMessage });

  const residents = useMemo(
    () => residentsResource.data?.residents ?? [],
    [residentsResource.data],
  );
  const rows = useMemo(() => matrixResource.data?.rows ?? [], [matrixResource.data]);
  const totals = matrixResource.data?.totals ?? null;
  const proofs = useMemo(
    () => paymentsResource.data?.proofs ?? [],
    [paymentsResource.data],
  );
  const combined = combineResources(
    residentsResource,
    matrixResource,
    paymentsResource,
  );
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
        setActionMessage(error instanceof Error ? error.message : "Could not create payment.");
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
          createdCount: number;
          skippedExistingCount: number;
          skippedNoFeeCount: number;
        }>(`${hostelAdminEndpoints.transactions}/generate`, {
          body: JSON.stringify({
            defaultAmount: monthlyFee ? Number(monthlyFee) : undefined,
            dueDate: field(form, "dueDate"),
            month: field(form, "month"),
          }),
          method: "POST",
        });

        setActionMessage(
          `${result.createdCount} payment record(s) created. ${result.skippedExistingCount} already existed, ${result.skippedNoFeeCount} skipped with no fee set.`,
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
    async (proofId: string, action: "approve" | "reject") => {
      const rejectionReason =
        action === "reject" ? window.prompt("Rejection reason")?.trim() : undefined;

      if (action === "reject" && !rejectionReason) {
        return;
      }

      try {
        await browserApi(`/api/v1/hostel-admin/payment-proofs/${proofId}/${action}`, {
          body: JSON.stringify(action === "reject" ? { rejectionReason } : {}),
          method: "PATCH",
        });
        setActionMessage(action === "approve" ? "Proof approved." : "Proof rejected.");
        refreshPayments();
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not review proof.");
      }
    },
    [refreshPayments],
  );

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

  const pendingProofs = proofs.filter((p) => p.status === "PENDING").slice(0, 6);

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
          <Tabs
            onValueChange={setFilter}
            value={filter}
          >
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList className="h-auto flex-wrap rounded-none bg-transparent p-0" variant="line">
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
              <span className="text-xs font-semibold text-muted-foreground">
                {pendingProofs.length} pending
              </span>
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
                      key={proof.id}
                    >
                      <div className="flex items-start gap-3">
                        {proof.proofImageAssetId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt="Payment proof"
                            className="size-12 rounded-lg object-cover"
                            src={`/api/v1/files/${proof.proofImageAssetId}/url?variant=THUMBNAIL`}
                          />
                        ) : (
                          <InitialsAvatar name={name} size="sm" tone="admin" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">{name}</p>
                          <p className="text-xs font-semibold text-foreground">
                            {currency(proof.amount)}
                            {proof.paymentMethod ? ` · ${proof.paymentMethod}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {proof.transactionCode || proof.referenceNote || "No txn code"}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <Button
                              className="h-8 flex-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90"
                              onClick={() => void reviewProof(proof.id, "approve")}
                              size="sm"
                              type="button"
                            >
                              <Check className="size-3.5" />
                              Approve
                            </Button>
                            <Button
                              className="h-8 flex-1 rounded-lg"
                              onClick={() => void reviewProof(proof.id, "reject")}
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
