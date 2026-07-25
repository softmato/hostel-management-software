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
import { memo, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

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

import {
  field,
  optionalField,
  type LoadState,
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

export const HostelAdminPaymentsPage = memo(function HostelAdminPaymentsPage() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const residentById = useMemo(
    () => new Map(residents.map((resident) => [resident.id, resident])),
    [residents],
  );

  const load = useCallback(async () => {
    setState("loading");
    try {
      const statusQuery = filter !== "ALL" ? `?status=${filter}` : "";
      const [residentData, paymentData] = await Promise.all([
        browserApi<{ residents: Resident[] }>("/api/v1/hostel-admin/residents"),
        browserApi<{ payments: Payment[]; proofs: PaymentProof[] }>(
          `/api/v1/hostel-admin/payments${statusQuery}`,
        ),
      ]);

      setResidents(residentData.residents);
      setPayments(paymentData.payments);
      setProofs(paymentData.proofs);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load payments.");
      setState("error");
    }
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  const handleCreatePayment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        await browserApi("/api/v1/hostel-admin/payments", {
          body: JSON.stringify({
            dueAmount: Number(field(form, "dueAmount")),
            dueDate: field(form, "dueDate"),
            month: field(form, "month"),
            residentId: field(form, "residentId"),
            remarks: optionalField(form, "remarks"),
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setShowCreate(false);
        setMessage("Payment record created.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not create payment.");
      }
    },
    [load],
  );

  const handleFeeRun = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const monthlyFee = optionalField(form, "monthlyFee");

      try {
        if (monthlyFee) {
          await browserApi("/api/v1/hostel-admin/residents/fees", {
            body: JSON.stringify({ monthlyFee: Number(monthlyFee) }),
            method: "PATCH",
          });
        }

        const result = await browserApi<{
          createdCount: number;
          skippedExistingCount: number;
          skippedNoFeeCount: number;
        }>("/api/v1/hostel-admin/payments/generate", {
          body: JSON.stringify({
            defaultAmount: monthlyFee ? Number(monthlyFee) : undefined,
            dueDate: field(form, "dueDate"),
            month: field(form, "month"),
          }),
          method: "POST",
        });

        setMessage(
          `${result.createdCount} payment record(s) created. ${result.skippedExistingCount} already existed, ${result.skippedNoFeeCount} skipped with no fee set.`,
        );
        await load();
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not run the monthly fee job.",
        );
      }
    },
    [load],
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
        setMessage(action === "approve" ? "Proof approved." : "Proof rejected.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not review proof.");
      }
    },
    [load],
  );

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return payments;
    return payments.filter((payment) => {
      const resident = residentById.get(payment.residentId);
      const name = resident
        ? `${resident.firstName} ${resident.lastName}`.toLowerCase()
        : payment.residentId.toLowerCase();
      return name.includes(query) || payment.month.toLowerCase().includes(query);
    });
  }, [payments, residentById, search]);

  const stats = useMemo(() => {
    const paid = payments.filter((p) => p.status === "PAID").length;
    const unpaid = payments.filter((p) => p.status === "UNPAID").length;
    const partial = payments.filter((p) => p.status === "PARTIAL").length;
    const overdue = payments.filter((p) => p.status === "OVERDUE").length;
    const monthlyCollection = payments.reduce((sum, p) => sum + p.paidAmount, 0);
    const dueAmount = payments.reduce(
      (sum, p) => sum + Math.max(0, p.dueAmount - p.paidAmount),
      0,
    );
    return {
      dueAmount,
      monthlyCollection,
      overdue,
      paid,
      partial,
      pendingProofs: proofs.filter((p) => p.status === "PENDING").length,
      unpaid,
    };
  }, [payments, proofs]);

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
                  All ({payments.length})
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
              {state === "ready" && filteredPayments.length === 0 ? (
                <EmptyInline label="No payment records." />
              ) : null}
              {state === "ready" && filteredPayments.length > 0 ? (
                <DataTable className="min-w-[700px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Resident
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Month
                      </TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Amount (NPR)
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
                    {filteredPayments.map((payment) => {
                      const resident = residentById.get(payment.residentId);
                      const name = resident
                        ? `${resident.firstName} ${resident.lastName}`
                        : payment.residentId;

                      return (
                        <TableRow key={payment.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <InitialsAvatar name={name} size="sm" tone="admin" />
                              <div>
                                <p className="font-semibold text-foreground">{name}</p>
                                {resident?.phone ? (
                                  <p className="text-xs text-muted-foreground">
                                    {resident.phone}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {payment.month}
                          </TableCell>
                          <TableCell className="font-medium">
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
                          <TableCell className="text-muted-foreground">
                            {new Date(payment.dueDate).toLocaleDateString()}
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
