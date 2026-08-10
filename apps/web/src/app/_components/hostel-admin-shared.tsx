"use client";

import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type Resident = {
  bedId: string;
  demoDataLabel?: string;
  depositAmount: number;
  email?: string;
  firstName: string;
  fullName?: string;
  id: string;
  isDemoData?: boolean;
  lastName: string;
  monthlyFee?: number;
  moveInDate: string;
  phone: string;
  residentType?: "STUDENT" | "WORKING_PROFESSIONAL" | "OTHER";
  roomType: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "MOVED_OUT";
};

export type AvailableRoomType = {
  monthlyRent: number;
  roomType: string;
  vacantBeds: number;
};

export type Payment = {
  dueAmount: number;
  dueDate: string;
  id: string;
  month: string;
  paidAmount: number;
  paymentMethod?: string;
  residentId: string;
  status: "UNPAID" | "PAID" | "PARTIAL" | "OVERDUE" | "PENDING_PROOF";
};

/**
 * A payment claim in the review queue.
 *
 * A `PENDING` `PaymentEvent` since item 2.8 — hence `eventId`, `invoiceId` and
 * `evidenceAssetId` in place of the old proof's fields, and `SETTLED` where the
 * screen says "approved". `residentName` comes down with the row so the queue
 * does not need a second request per claim.
 */
/** One server-computed check on a claim (item 3.5). Amber never blocks a review. */
export type ClaimCheck = {
  detail: string;
  key: string;
  ok: boolean;
};

export type PaymentProof = {
  /** True when every check passed — the only rows `Approve all` may touch. */
  allGreen?: boolean;
  amount: number;
  checks?: ClaimCheck[];
  eventId: string;
  evidenceAssetId: string | null;
  invoiceId: string | null;
  method?: string;
  occurredAt?: string;
  period?: string | null;
  referenceNote?: string | null;
  rejectionReason?: string;
  residentId: string;
  residentName?: string;
  reviewFlags?: string[];
  status: "PENDING" | "SETTLED" | "REJECTED";
  transactionCode?: string | null;
};

export type Notice = {
  category: string;
  content: string;
  expiresAt?: string;
  id: string;
  isUrgent: boolean;
  publishedAt?: string;
  title: string;
};

export type Complaint = {
  adminResponse?: string;
  attachments: Array<{ fileAssetId: string; id: string }>;
  category: string;
  confirmedAt?: string;
  createdAt?: string;
  description: string;
  id: string;
  isAnonymous: boolean;
  isOverdue: boolean;
  residentId: string | null;
  slaDueAt: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  title: string;
};

export type ComplaintSummary = {
  inProgress: number;
  overdue: number;
  pending: number;
  rejected: number;
  resolved: number;
  total: number;
};

export function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalField(form: FormData, name: string) {
  const value = field(form, name);
  return value.length > 0 ? value : undefined;
}

export function DemoDataBadge({ label }: { label?: string }) {
  return (
    <span
      className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"
      title={label || "Seeded demo/test data"}
    >
      Mock/Test data
    </span>
  );
}

export function PageHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-role-admin-soft p-3 text-role-admin">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
