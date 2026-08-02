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
      area?: string;
      city?: string;
    };
    name: string;
    photoUrl?: string;
  } | null;
  nightStatus: {
    checkedAt: string | null;
    status: string;
  };
  notices: Notice[];
  resident: ResidentSummary;
  roomBed: {
    bed: {
      bedNumber: string;
      status: string;
    } | null;
    room: {
      roomNumber: string;
      roomType: string;
    } | null;
  };
};

export type Payment = {
  dueAmount: number;
  dueDate: string;
  id: string;
  month: string;
  paidAmount: number;
  status: "UNPAID" | "PAID" | "PARTIAL" | "OVERDUE" | "PENDING_PROOF";
};

export type PaymentProof = {
  amount: number;
  id: string;
  paymentId: string;
  paymentMethod?: string;
  proofImageAssetId: string;
  referenceNote?: string;
  rejectionReason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  transactionCode?: string;
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
