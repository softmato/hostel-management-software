"use client";

import { Home } from "lucide-react";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type ResidentSummary = {
  depositAmount: number;
  email?: string;
  firstName: string;
  fullName?: string;
  id: string;
  lastName: string;
  phone: string;
  residentType?: "STUDENT" | "WORKING_PROFESSIONAL" | "OTHER";
  status: string;
};

export type ResidentDashboard = {
  /**
   * Residents are placed by room type (the sharing tier they pay for), not by
   * an individual room or bed record — see the note on the Resident model.
   */
  accommodation: {
    roomType: string;
  };
  complaints: {
    openCount: number;
  };
  feeStatus: {
    dueAmount: number;
    latestPayment?: Payment | null;
    pendingProofs: number;
    unpaidCount: number;
  };
  foodMenu: FoodMenu[];
  hostel: {
    contact?: {
      email?: string;
      phone?: string;
    };
    location?: {
      address?: string;
      area?: string;
      city?: string;
    };
    name: string;
    /** First EXTERIOR photo when there is one, else the first photo at all. */
    photoUrl?: string;
    slug?: string;
  } | null;
  nightStatus: {
    checkedAt: string | null;
    status: string;
  };
  notices: Notice[];
  resident: ResidentSummary;
};

/**
 * An invoice, as the portal reads it.
 *
 * Still called `Payment` and still speaking `UNPAID`: the ledger facade
 * translates on the way out so the screens could keep working while the models
 * changed underneath them (item 2.8). Block 3 renames both together, per screen.
 * `month` is the invoice's `period`.
 */
export type Payment = {
  dueAmount: number;
  dueDate: string;
  id: string;
  month: string;
  paidAmount: number;
  /**
   * Every receipt for this month that has not been voided, newest first.
   *
   * A list rather than one: there is a receipt per settled payment, so a month
   * paid in instalments has several and the resident needs all of them.
   */
  receipts?: {
    amount: number;
    id: string;
    issuedAt: string | null;
    number: string;
  }[];
  /** This month's reference code — what the Resident Offer Program runs on. */
  referenceCode?: string | null;
  status: "UNPAID" | "PAID" | "PARTIAL" | "OVERDUE" | "PENDING_PROOF";
};

/**
 * A payment claim awaiting review — a `PENDING` `PaymentEvent` since item 2.8,
 * which is why it carries `eventId` and `invoiceId` rather than a `paymentId`.
 * `SETTLED` is the ledger's word for what the screens label "approved".
 */
export type PaymentProof = {
  amount: number;
  eventId: string;
  evidenceAssetId: string | null;
  id?: string;
  invoiceId: string | null;
  method?: string;
  referenceNote?: string | null;
  rejectionReason?: string | null;
  status: "PENDING" | "SETTLED" | "REJECTED";
  transactionCode?: string | null;
};

export type FoodMenu = {
  dayOfWeek:
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";
  items: string[];
  mealType: "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER";
  note: string;
  timing: string;
};

export type FoodRoutine = {
  meals: FoodMenu[];
  monthEndSpecial: { items: string[]; note: string } | null;
};

export type FoodPhoto = {
  caption?: string;
  date: string;
  id: string;
  mealType: string;
  photoAssetId: string;
};

export type Notice = {
  category: string;
  content: string;
  id: string;
  isRead?: boolean;
  isUrgent: boolean;
  publishedAt?: string;
  readAt?: string;
  title: string;
};

export type Complaint = {
  adminResponse?: string;
  attachments: Array<{
    fileAssetId: string;
    id: string;
  }>;
  category: string;
  confirmedAt?: string;
  createdAt?: string;
  description: string;
  id: string;
  isAnonymous: boolean;
  isOverdue: boolean;
  slaDueAt: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  title: string;
};

export function field(form: FormData, name: string) {
  const value = form.get(name);

  return typeof value === "string" ? value.trim() : "";
}

export function optionalField(form: FormData, name: string) {
  const value = field(form, name);

  return value.length > 0 ? value : undefined;
}

export function ResidentHeader({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Home;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="rounded-lg bg-role-resident-soft p-3 text-role-resident">
        <Icon className="size-5" />
      </span>
      <div>
        <h1 className="font-heading text-3xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function Message({ value }: { value: string }) {
  return value ? (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{value}</div>
  ) : null;
}
