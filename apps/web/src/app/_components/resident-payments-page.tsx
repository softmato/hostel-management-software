"use client";

import {
  CalendarDays,
  Download,
  ReceiptText,
  ShieldCheck,
  Upload,
  WalletCards,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  currency,
  EmptyState,
  Input as FormInput,
  LoadingRows,
  Select as FormSelect,
} from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/browser-api";
import {
  type LoadState,
  type Payment,
  type PaymentProof,
  Message,
  field,
  optionalField,
} from "./resident-shared";
import {
  DataTable,
  EmptyInline,
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

export const ResidentPaymentsPageContent = memo(function ResidentPaymentsPageContent() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [proofAssetId, setProofAssetId] = useState("");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [statusTab, setStatusTab] = useState("ALL");

  const proofByPaymentId = useMemo(
    () => new Map(proofs.map((proof) => [proof.paymentId, proof])),
    [proofs],
  );

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await browserApi<{ payments: Payment[]; proofs: PaymentProof[] }>(
        "/api/v1/resident/payments",
      );

      setPayments(data.payments);
      setProofs(data.proofs);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load payments.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  const handleProofFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    try {
      const { uploadFile, optimizeImage } = await import("@/lib/client-upload");
      const assetId = await uploadFile(file, "PRIVATE");
      optimizeImage(assetId).catch(() => {});
      setProofAssetId(assetId);
      setMessage("Proof image uploaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload image.");
    } finally {
      setUploadingProof(false);
    }
  }, []);

  const handleProof = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const paymentId = field(form, "paymentId");

      if (!proofAssetId) {
        setMessage("Please upload a proof image first.");
        return;
      }

      try {
        await browserApi(`/api/v1/resident/payments/${paymentId}/proof`, {
          body: JSON.stringify({
            amount: Number(field(form, "amount")),
            paymentMethod: field(form, "paymentMethod"),
            proofImageAssetId: proofAssetId,
            referenceNote: optionalField(form, "referenceNote"),
            transactionCode: optionalField(form, "transactionCode"),
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setProofAssetId("");
        setMessage("Proof submitted.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not submit proof.");
      }
    },
    [proofAssetId, load],
  );

  const stats = useMemo(() => {
    const paid = payments.filter((p) => p.status === "PAID").length;
    const unpaid = payments.filter((p) => p.status === "UNPAID").length;
    const partial = payments.filter((p) => p.status === "PARTIAL").length;
    const overdue = payments.filter((p) => p.status === "OVERDUE").length;
    const totalDue = payments.reduce(
      (sum, p) => sum + Math.max(0, p.dueAmount - p.paidAmount),
      0,
    );
    const lastPaid = payments.find((p) => p.status === "PAID");
    const nextDue = payments.find(
      (p) => p.status === "UNPAID" || p.status === "OVERDUE" || p.status === "PARTIAL",
    );
    return { lastPaid, nextDue, overdue, paid, partial, totalDue, unpaid };
  }, [payments]);

  const filteredPayments = useMemo(() => {
    if (statusTab === "ALL") return payments;
    return payments.filter((p) => p.status === statusTab);
  }, [payments, statusTab]);

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PortalPageHeader
        breadcrumb={["Home", "Payments"]}
        description="Review monthly dues and submit payment proof."
        title="My Payments"
      />
      <Message value={message} />

      <Tabs onValueChange={setStatusTab} value={statusTab}>
        <TabsList className="h-auto flex-wrap rounded-xl bg-muted/50 p-1">
          <TabsTrigger className="rounded-lg px-3" value="ALL">
            All {payments.length}
          </TabsTrigger>
          <TabsTrigger className="rounded-lg px-3" value="PAID">
            Paid {stats.paid}
          </TabsTrigger>
          <TabsTrigger className="rounded-lg px-3" value="UNPAID">
            Unpaid {stats.unpaid}
          </TabsTrigger>
          <TabsTrigger className="rounded-lg px-3" value="PARTIAL">
            Partial {stats.partial}
          </TabsTrigger>
          <TabsTrigger className="rounded-lg px-3" value="OVERDUE">
            Overdue {stats.overdue}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label="Total Due Amount"
          tone="rose"
          trend={stats.overdue > 0 ? `${stats.overdue} invoice(s) overdue` : "No overdue"}
          trendDown={stats.overdue > 0}
          value={currency(stats.totalDue)}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Deposit Status"
          tone="green"
          trend="Recorded with hostel"
          value="Tracked"
        />
        <MetricCard
          icon={CalendarDays}
          label="Next Due Date"
          tone="blue"
          trend={stats.nextDue?.month ?? "No open dues"}
          value={
            stats.nextDue?.dueDate
              ? new Date(stats.nextDue.dueDate).toLocaleDateString()
              : "—"
          }
        />
        <MetricCard
          icon={ReceiptText}
          label="Last Payment"
          tone="cyan"
          trend={stats.lastPaid?.month ?? "No payments yet"}
          value={stats.lastPaid ? currency(stats.lastPaid.paidAmount) : "—"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <SectionCard
          actions={
            <Button className="h-9 gap-2 rounded-xl" type="button" variant="outline">
              <Download className="size-4" />
              Download Statement
            </Button>
          }
          title="Payment History"
        >
          {state === "loading" ? <LoadingRows /> : null}
          {state === "error" ? <EmptyState label="Payments could not be loaded." /> : null}
          {state === "ready" && filteredPayments.length === 0 ? (
            <EmptyInline label="No payments in this filter." />
          ) : null}
          {state === "ready" && filteredPayments.length > 0 ? (
            <DataTable className="min-w-[640px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Month
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Amount (NPR)
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Due Date
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Paid
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Receipt
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((payment) => {
                  const proof = proofByPaymentId.get(payment.id);
                  const isOpen =
                    payment.status === "UNPAID" ||
                    payment.status === "OVERDUE" ||
                    payment.status === "PARTIAL";

                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="font-semibold text-foreground">
                        {payment.month}
                      </TableCell>
                      <TableCell>{currency(payment.dueAmount)}</TableCell>
                      <TableCell>
                        <SoftBadge tone={statusToneFromLabel(payment.status)}>
                          {payment.status.replaceAll("_", " ")}
                        </SoftBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(payment.dueDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.paidAmount > 0 ? currency(payment.paidAmount) : "—"}
                      </TableCell>
                      <TableCell>
                        {isOpen ? (
                          <SoftBadge tone="amber">Pay Now</SoftBadge>
                        ) : proof ? (
                          <SoftBadge tone="green">View</SoftBadge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
          ) : null}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            description="Your payment is secure and encrypted."
            title="Upload Payment Proof"
          >
            <form className="grid gap-3" onSubmit={handleProof}>
              <FormSelect label="Payment" name="paymentId" required>
                <option value="">Select payment</option>
                {payments
                  .filter((payment) => payment.status !== "PAID")
                  .map((payment) => (
                    <option key={payment.id} value={payment.id}>
                      {payment.month} / {currency(payment.dueAmount)}
                    </option>
                  ))}
              </FormSelect>

              <div className="grid gap-2">
                <label className="text-sm font-semibold text-foreground">
                  Upload Receipt / Screenshot
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-role-resident/40 bg-role-resident-soft/30 px-4 py-8 text-center transition hover:bg-role-resident-soft/50">
                  <Upload className="mb-2 size-6 text-role-resident" />
                  <span className="text-sm font-semibold text-foreground">
                    Drag & drop or click to upload
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    JPG, PNG, PDF up to 5MB
                  </span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploadingProof}
                    onChange={handleProofFile}
                    type="file"
                  />
                </label>
                {uploadingProof ? (
                  <p className="text-xs text-muted-foreground">Uploading...</p>
                ) : proofAssetId ? (
                  <p className="text-xs font-semibold text-emerald-600">Image uploaded.</p>
                ) : null}
              </div>

              <input name="proofImageAssetId" type="hidden" value={proofAssetId} />
              <FormSelect defaultValue="ESEWA" label="Payment method" name="paymentMethod" required>
                <option value="ESEWA">eSewa</option>
                <option value="FONEPAY">Fonepay</option>
                <option value="KHALTI">Khalti</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
                <option value="OTHER">Other</option>
              </FormSelect>
              <FormInput
                label="Amount paid"
                min="1"
                name="amount"
                required
                step="0.01"
                type="number"
              />
              <FormInput label="Transaction code" name="transactionCode" />
              <div className="grid gap-1.5">
                <label className="text-sm font-semibold text-foreground">Notes (Optional)</label>
                <Textarea
                  className="min-h-20 rounded-xl"
                  maxLength={200}
                  name="referenceNote"
                  placeholder="Add any notes about this payment..."
                />
              </div>
              <RoleButton
                className="w-full"
                disabled={uploadingProof || !proofAssetId}
                tone="resident"
                type="submit"
              >
                <Upload className="size-4" />
                Submit Payment Proof
              </RoleButton>
            </form>
          </SectionCard>

          <SectionCard title="Recent Receipt">
            {stats.lastPaid ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Month</span>
                  <span className="font-semibold">{stats.lastPaid.month}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">
                    {currency(stats.lastPaid.paidAmount)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Status</span>
                  <SoftBadge tone="green">Paid</SoftBadge>
                </div>
              </div>
            ) : (
              <EmptyInline label="No receipts yet." />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
});
