import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { PaymentModel } from "@hostel/db/models/Payment";
import { PaymentProofModel } from "@hostel/db/models/PaymentProof";
import { ReceiptModel } from "@hostel/db/models/Receipt";
import { ResidentModel } from "@hostel/db/models/Resident";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
  type ResidentRecord,
} from "@/modules/residents/resident-access";
import {
  appUrl,
  getHostelName,
  resolveHostelAdminContacts,
  resolveResidentContact,
  sendNotificationEmail,
} from "@/modules/residents/resident-notify";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { markReferralConverted } from "@/modules/referrals/referral.service";
import { paymentProofUploadedEmail } from "@hostel/shared/email/templates/payment/proof-uploaded";
import { paymentRejectedEmail } from "@hostel/shared/email/templates/payment/payment-rejected";
import { paymentVerifiedEmail } from "@hostel/shared/email/templates/payment/payment-verified";
import type {
  monthlyPaymentGenerateSchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  paymentMatrixQuerySchema,
  paymentProofReviewSchema,
  paymentProofSubmitSchema,
  paymentUpdateSchema,
  residentFeeUpdateSchema,
} from "@/modules/payments/payment.validation";

type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>;
type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
type PaymentProofSubmitInput = z.infer<typeof paymentProofSubmitSchema>;
type PaymentProofReviewInput = z.infer<typeof paymentProofReviewSchema>;
type MonthlyPaymentGenerateInput = z.infer<typeof monthlyPaymentGenerateSchema>;
type PaymentMatrixQuery = z.infer<typeof paymentMatrixQuerySchema>;
type ResidentFeeUpdateInput = z.infer<typeof residentFeeUpdateSchema>;

type PaymentStatus = "UNPAID" | "PAID" | "PARTIAL" | "OVERDUE" | "PENDING_PROOF";
type PaymentMethod = "CASH" | "ESEWA" | "KHALTI" | "FONEPAY" | "BANK_TRANSFER" | "OTHER";
type ProofStatus = "PENDING" | "APPROVED" | "REJECTED";

type PaymentRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  dueAmount: number;
  dueDate: Date;
  hostelId: Types.ObjectId;
  month: string;
  paidAmount: number;
  paidDate?: Date;
  paymentMethod?: PaymentMethod;
  remarks?: string;
  residentId: Types.ObjectId;
  status: PaymentStatus;
  updatedAt?: Date;
};

type PaymentProofRecord = {
  _id: Types.ObjectId;
  amount: number;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  paymentId: Types.ObjectId;
  paymentMethod?: PaymentMethod;
  proofImageAssetId: string;
  referenceNote?: string;
  rejectionReason?: string;
  residentId: Types.ObjectId;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  status: ProofStatus;
  submittedAt: Date;
  submittedBy: Types.ObjectId;
  transactionCode?: string;
};

type ReceiptRecord = {
  _id: Types.ObjectId;
  amount: number;
  hostelId: Types.ObjectId;
  issuedAt: Date;
  issuedBy: Types.ObjectId;
  month: string;
  paymentId: Types.ObjectId;
  receiptNumber: string;
  residentId: Types.ObjectId;
};

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "PAYMENT_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value, "hostel id"));
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new PaymentServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

function scopedHostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    return { hostelId: resolveAdminHostelId(principal, requestedHostelId) };
  }

  return {
    hostelId: {
      $in: normalizeObjectIds(principal.hostelIds),
    },
  };
}

function definedUpdate(input: Record<string, unknown>, omittedKeys: string[] = []) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && !omittedKeys.includes(key),
    ),
  );
}

function serializePayment(payment: PaymentRecord) {
  return {
    createdAt: payment.createdAt?.toISOString(),
    dueAmount: payment.dueAmount,
    dueDate: payment.dueDate.toISOString(),
    hostelId: payment.hostelId.toString(),
    id: payment._id.toString(),
    month: payment.month,
    paidAmount: payment.paidAmount,
    paidDate: payment.paidDate?.toISOString(),
    paymentMethod: payment.paymentMethod,
    remarks: payment.remarks ?? "",
    residentId: payment.residentId.toString(),
    status: payment.status,
    updatedAt: payment.updatedAt?.toISOString(),
  };
}

function serializePaymentProof(proof: PaymentProofRecord) {
  return {
    amount: proof.amount ?? 0,
    createdAt: proof.createdAt?.toISOString(),
    hostelId: proof.hostelId.toString(),
    id: proof._id.toString(),
    paymentId: proof.paymentId.toString(),
    paymentMethod: proof.paymentMethod,
    proofImageAssetId: proof.proofImageAssetId,
    referenceNote: proof.referenceNote ?? "",
    rejectionReason: proof.rejectionReason ?? "",
    residentId: proof.residentId.toString(),
    reviewedAt: proof.reviewedAt?.toISOString(),
    reviewedBy: proof.reviewedBy?.toString(),
    status: proof.status,
    submittedAt: proof.submittedAt.toISOString(),
    submittedBy: proof.submittedBy.toString(),
    transactionCode: proof.transactionCode ?? "",
  };
}

function serializeReceipt(receipt: ReceiptRecord) {
  return {
    amount: receipt.amount,
    hostelId: receipt.hostelId.toString(),
    id: receipt._id.toString(),
    issuedAt: receipt.issuedAt.toISOString(),
    issuedBy: receipt.issuedBy.toString(),
    month: receipt.month,
    paymentId: receipt.paymentId.toString(),
    receiptNumber: receipt.receiptNumber,
    residentId: receipt.residentId.toString(),
  };
}

async function auditPaymentAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  entityId: Types.ObjectId,
  entityType: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: entityId.toString(),
    entityType,
    hostelId,
    metadata,
  });
}

async function findAdminResident(
  residentId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const resident = await ResidentModel.findOne({
    _id: normalizeObjectId(residentId, "resident id"),
    isDeleted: false,
    ...scopedHostelFilter(principal, requestedHostelId),
  }).lean<ResidentRecord | null>();

  if (!resident) {
    throw new PaymentServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  return resident;
}

async function findAdminPayment(
  paymentId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const payment = await PaymentModel.findOne({
    _id: normalizeObjectId(paymentId, "payment id"),
    ...scopedHostelFilter(principal, requestedHostelId),
  }).lean<PaymentRecord | null>();

  if (!payment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  return payment;
}

async function findAdminPaymentProof(
  proofId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const proof = await PaymentProofModel.findOne({
    _id: normalizeObjectId(proofId, "payment proof id"),
    ...scopedHostelFilter(principal, requestedHostelId),
  }).lean<PaymentProofRecord | null>();

  if (!proof) {
    throw new PaymentServiceError(
      "Payment proof was not found.",
      "PAYMENT_PROOF_NOT_FOUND",
      404,
    );
  }

  return proof;
}

/**
 * Allocates the next sequential receipt number for a month, e.g.
 * `RCP-2026-08-00123`. `receiptNumber` carries a unique index, so a race
 * between two verifications surfaces as a duplicate-key error and is retried
 * with the next free sequence rather than silently reusing a number.
 */
async function nextReceiptNumber(month: string, attempt = 0): Promise<string> {
  const config = await getOperationsConfig();
  const prefix = `${config.receiptNumberPrefix}-${month}-`;
  const latest = await ReceiptModel.findOne({
    receiptNumber: { $regex: `^${prefix}` },
  })
    .sort({ receiptNumber: -1 })
    .lean<{ receiptNumber: string } | null>();

  const lastSequence = latest
    ? Number.parseInt(latest.receiptNumber.slice(prefix.length), 10)
    : 0;
  const sequence = (Number.isNaN(lastSequence) ? 0 : lastSequence) + 1 + attempt;

  return `${prefix}${String(sequence).padStart(5, "0")}`;
}

/**
 * One receipt per payment. Re-verifying a partially paid month updates the
 * existing receipt's amount instead of minting a second number, so a resident's
 * receipt always reflects what the hostel has confirmed for that month.
 */
export async function generateReceipt(payment: PaymentRecord, principal: ApiPrincipal) {
  const existingReceipt = await ReceiptModel.findOneAndUpdate(
    { paymentId: payment._id, residentId: payment.residentId },
    { $set: { amount: payment.paidAmount } },
    { new: true },
  ).lean<ReceiptRecord | null>();

  if (existingReceipt) {
    return existingReceipt;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return (await ReceiptModel.create({
        amount: payment.paidAmount,
        hostelId: payment.hostelId,
        issuedBy: principal.userId,
        month: payment.month,
        paymentId: payment._id,
        receiptNumber: await nextReceiptNumber(payment.month, attempt),
        residentId: payment.residentId,
      })) as ReceiptRecord;
    } catch (error) {
      const isDuplicate =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: number }).code === 11000
          : false;

      if (!isDuplicate) {
        throw error;
      }
    }
  }

  throw new PaymentServiceError(
    "Could not allocate a receipt number. Please retry.",
    "RECEIPT_NUMBER_CONFLICT",
    503,
  );
}

export async function createPaymentRecord(
  input: PaymentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findAdminResident(input.residentId, principal, input.hostelId);
  const payment = await PaymentModel.create({
    ...input,
    createdBy: principal.userId,
    hostelId: resident.hostelId,
    residentId: resident._id,
    updatedBy: principal.userId,
  });

  await auditPaymentAction(
    principal,
    resident.hostelId,
    payment._id,
    "Payment",
    "PAYMENT_CREATED",
    { residentId: resident._id.toString(), status: input.status },
  );

  return {
    payment: serializePayment(payment as PaymentRecord),
    resident: serializeResidentSummary(resident),
  };
}

export async function listPayments(query: PaymentListQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.residentId) {
    filter.residentId = normalizeObjectId(query.residentId, "resident id");
  }

  if (query.month) {
    filter.month = query.month;
  }

  if (query.status) {
    filter.status = query.status;
  }

  const { limit, skip } = paginationRange(query);

  const [payments, total] = await Promise.all([
    PaymentModel.find(filter)
      .sort({ dueDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PaymentRecord[]>(),
    PaymentModel.countDocuments(filter),
  ]);
  const proofs = await PaymentProofModel.find({
    paymentId: { $in: payments.map((payment) => payment._id) },
  })
    .sort({ submittedAt: -1 })
    .lean<PaymentProofRecord[]>();

  return {
    pagination: paginationMeta(query, total),
    payments: payments.map(serializePayment),
    // Scoped to the payments on this page, not the whole filter — a proof is
    // only ever rendered next to its payment.
    proofs: proofs.map(serializePaymentProof),
  };
}

export async function updatePaymentRecord(
  paymentId: string,
  input: PaymentUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const payment = await findAdminPayment(paymentId, principal, input.hostelId);
  const update = definedUpdate(input, ["hostelId"]);
  const updatedPayment = await PaymentModel.findOneAndUpdate(
    { _id: payment._id },
    {
      $set: {
        ...update,
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<PaymentRecord | null>();

  if (!updatedPayment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  let receipt: ReceiptRecord | null = null;

  if (updatedPayment.status === "PAID") {
    receipt = await generateReceipt(updatedPayment, principal);
  }

  await auditPaymentAction(
    principal,
    payment.hostelId,
    payment._id,
    "Payment",
    "PAYMENT_UPDATED",
    { previousStatus: payment.status, status: updatedPayment.status },
  );

  return {
    payment: serializePayment(updatedPayment),
    receipt: receipt ? serializeReceipt(receipt) : null,
  };
}

export async function listResidentPayments(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const payments = await PaymentModel.find({
    hostelId: resident.hostelId,
    residentId: resident._id,
  })
    .sort({ dueDate: -1 })
    .lean<PaymentRecord[]>();
  const proofs = await PaymentProofModel.find({
    residentId: resident._id,
    paymentId: { $in: payments.map((payment) => payment._id) },
  })
    .sort({ submittedAt: -1 })
    .lean<PaymentProofRecord[]>();

  return {
    payments: payments.map(serializePayment),
    proofs: proofs.map(serializePaymentProof),
    resident: serializeResidentSummary(resident),
  };
}

export async function submitPaymentProof(
  paymentId: string,
  input: PaymentProofSubmitInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const payment = await PaymentModel.findOne({
    _id: normalizeObjectId(paymentId, "payment id"),
    hostelId: resident.hostelId,
    residentId: resident._id,
  }).lean<PaymentRecord | null>();

  if (!payment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  if (payment.status === "PAID") {
    throw new PaymentServiceError(
      "This payment is already paid.",
      "PAYMENT_ALREADY_PAID",
      409,
    );
  }

  const proof = await PaymentProofModel.create({
    ...input,
    hostelId: resident.hostelId,
    paymentId: payment._id,
    residentId: resident._id,
    status: "PENDING",
    submittedBy: principal.userId,
  });
  const updatedPayment = await PaymentModel.findOneAndUpdate(
    { _id: payment._id },
    { $set: { status: "PENDING_PROOF", updatedBy: principal.userId } },
    { new: true },
  ).lean<PaymentRecord | null>();

  await auditPaymentAction(
    principal,
    resident.hostelId,
    proof._id,
    "PaymentProof",
    "PAYMENT_PROOF_SUBMITTED",
    { paymentId: payment._id.toString() },
  );

  await notifyAdminsOfProof(resident, payment, input, proof._id.toString());

  // Live-refresh every payments panel in this hostel, plus the resident's own
  // screens, so the proof appears in the verification queue without a reload.
  await publishResourceChange({
    hostelIds: [resident.hostelId.toString()],
    topics: [REALTIME_TOPIC.PAYMENTS],
    userIds: [principal.userId],
  });

  return {
    payment: updatedPayment
      ? serializePayment(updatedPayment)
      : serializePayment(payment),
    proof: serializePaymentProof(proof as PaymentProofRecord),
    resident: serializeResidentSummary(resident),
  };
}

/** Never throws — the proof is already saved by the time this runs. */
async function notifyAdminsOfProof(
  resident: ResidentRecord,
  payment: PaymentRecord,
  input: PaymentProofSubmitInput,
  proofId: string,
) {
  try {
    await deliverProofNotification(resident, payment, input, proofId);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "payment_proof_notification_failed",
        message: error instanceof Error ? error.message : "Unknown notification error",
        paymentId: payment._id.toString(),
      }),
    );
  }
}

async function deliverProofNotification(
  resident: ResidentRecord,
  payment: PaymentRecord,
  input: PaymentProofSubmitInput,
  proofId: string,
) {
  // `sendPaymentEmails` is an *email* switch. It used to return early here,
  // which silently took the in-app notification down with it and left the
  // verification queue with nothing pointing at it — so the gate now sits on
  // the email send alone, further down.
  const config = await getOperationsConfig();

  const [hostelName, admins] = await Promise.all([
    getHostelName(resident.hostelId),
    resolveHostelAdminContacts(resident.hostelId),
  ]);
  const residentName = `${resident.firstName} ${resident.lastName}`.trim();
  const email = paymentProofUploadedEmail({
    amount: input.amount,
    hostelName,
    method: input.paymentMethod,
    month: payment.month,
    referenceNote: input.referenceNote ?? input.transactionCode,
    residentName,
    reviewUrl: appUrl("/hostel-admin/payments"),
  });

  await Promise.all(
    admins.map(async (admin) => {
      if (admin.userId) {
        await createInAppNotification({
          // Verifying is a one-click decision, so it happens in the bell.
          // Rejecting needs a written reason, so that one only deep-links.
          actions: [
            {
              endpoint: `/api/v1/hostel-admin/payment-proofs/${proofId}/approve`,
              key: "approve",
              label: "Verify payment",
              method: "PATCH",
              payload: {},
              tone: "primary",
            },
          ],
          actionUrl: "/hostel-admin/payments",
          body: `${residentName} uploaded a payment proof of Rs. ${input.amount} for ${payment.month}.`,
          category: "PAYMENT",
          data: { paymentId: payment._id.toString(), proofId },
          hostelId: resident.hostelId.toString(),
          kind: "ACTION",
          title: "Payment proof to verify",
          userId: admin.userId,
        });
      }

      if (config.sendPaymentEmails) {
        await sendNotificationEmail({
          action: "payment_proof_uploaded",
          html: email.html,
          subject: email.subject,
          to: admin.email,
        });
      }
    }),
  );
}

function alreadyReviewedError() {
  return new PaymentServiceError(
    "This payment proof has already been reviewed.",
    "PAYMENT_PROOF_ALREADY_REVIEWED",
    409,
  );
}

/** Cheap pre-check so a repeat review fails before any write is attempted. */
function assertProofIsPending(proof: PaymentProofRecord) {
  if (proof.status !== "PENDING") {
    throw alreadyReviewedError();
  }
}

/**
 * Adds a verified proof's amount to the month, never exceeding what is owed.
 *
 * The update is conditional on the `paidAmount` we read, so two proofs approved
 * at the same moment cannot both write from the same starting balance — the
 * loser re-reads the fresh total and applies its amount on top.
 */
async function creditVerifiedAmount(
  payment: PaymentRecord,
  verifiedAmount: number,
  context: {
    paymentMethod?: PaymentMethod;
    principal: ApiPrincipal;
    verifiedAt: Date;
  },
) {
  let current: PaymentRecord | null = payment;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!current) {
      throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
    }

    const paidAmount = Math.min(current.paidAmount + verifiedAmount, current.dueAmount);
    const updated = await PaymentModel.findOneAndUpdate(
      { _id: current._id, paidAmount: current.paidAmount },
      {
        $set: {
          paidAmount,
          paidDate: context.verifiedAt,
          paymentMethod: context.paymentMethod ?? current.paymentMethod,
          status: paidAmount >= current.dueAmount ? "PAID" : "PARTIAL",
          updatedBy: context.principal.userId,
        },
      },
      { new: true },
    ).lean<PaymentRecord | null>();

    if (updated) {
      return updated;
    }

    current = await PaymentModel.findOne({
      _id: payment._id,
    }).lean<PaymentRecord | null>();
  }

  throw new PaymentServiceError(
    "Could not record the verified amount because the payment kept changing. Please retry.",
    "PAYMENT_UPDATE_CONFLICT",
    503,
  );
}

export async function approvePaymentProof(
  proofId: string,
  input: PaymentProofReviewInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const proof = await findAdminPaymentProof(proofId, principal, input.hostelId);
  const now = new Date();

  assertProofIsPending(proof);

  const payment = await PaymentModel.findOne({
    _id: proof.paymentId,
    hostelId: proof.hostelId,
    residentId: proof.residentId,
  }).lean<PaymentRecord | null>();

  if (!payment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  // Claim the proof BEFORE crediting the payment. The filter only matches while
  // the proof is still PENDING, so a double-click (or a retried request) loses
  // the race here instead of adding the same money to the month twice.
  const reviewedProof = await PaymentProofModel.findOneAndUpdate(
    { _id: proof._id, status: "PENDING" },
    {
      $set: {
        reviewedAt: now,
        reviewedBy: principal.userId,
        status: "APPROVED",
      },
      $unset: { rejectionReason: "" },
    },
    { new: true },
  ).lean<PaymentProofRecord | null>();

  if (!reviewedProof) {
    throw alreadyReviewedError();
  }

  // Proofs carry the amount the resident actually paid, so a part-payment
  // settles the month partially instead of closing it out in full.
  const verifiedAmount = proof.amount ?? payment.dueAmount;
  const paidPayment = await creditVerifiedAmount(payment, verifiedAmount, {
    paymentMethod: proof.paymentMethod,
    principal,
    verifiedAt: now,
  });

  const receipt = await generateReceipt(paidPayment, principal);

  await auditPaymentAction(
    principal,
    proof.hostelId,
    proof._id,
    "PaymentProof",
    "PAYMENT_PROOF_APPROVED",
    {
      amount: verifiedAmount,
      paymentId: proof.paymentId.toString(),
      // Lets an auditor tie every rupee of paidAmount back to one proof.
      resultingPaidAmount: paidPayment.paidAmount,
      resultingStatus: paidPayment.status,
    },
  );

  // A referred resident only counts as converted once real money has been
  // verified (PHASES.md §5.1). Idempotent, and swallows its own failures.
  const referral = await markReferralConverted({
    hostelId: proof.hostelId,
    paymentId: paidPayment._id,
    residentId: proof.residentId,
  });

  await notifyResidentOfReview(paidPayment, {
    kind: "verified",
    receiptNumber: receipt.receiptNumber,
    verifiedAmount,
  });

  return {
    payment: serializePayment(paidPayment),
    proof: serializePaymentProof(reviewedProof),
    receipt: serializeReceipt(receipt),
    referralConverted: referral.converted,
  };
}

/**
 * Emails and in-app-notifies the resident about a proof decision. Never throws:
 * the verification itself has already been persisted by the time this runs, so
 * a notification problem must not turn a successful review into an error.
 */
async function notifyResidentOfReview(
  payment: PaymentRecord,
  outcome:
    | { kind: "verified"; receiptNumber: string; verifiedAmount: number }
    | { kind: "rejected"; rejectionReason: string },
) {
  try {
    await deliverReviewNotification(payment, outcome);
    // The verification queue shrank and the resident's balance moved — refresh
    // both sides' payment panels.
    await publishResourceChange({
      hostelIds: [payment.hostelId.toString()],
      topics: [REALTIME_TOPIC.PAYMENTS],
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "payment_review_notification_failed",
        message: error instanceof Error ? error.message : "Unknown notification error",
        paymentId: payment._id.toString(),
      }),
    );
  }
}

async function deliverReviewNotification(
  payment: PaymentRecord,
  outcome:
    | { kind: "verified"; receiptNumber: string; verifiedAmount: number }
    | { kind: "rejected"; rejectionReason: string },
) {
  const config = await getOperationsConfig();

  if (!config.sendPaymentEmails) {
    return;
  }

  const resident = await ResidentModel.findOne({
    _id: payment.residentId,
    isDeleted: false,
  }).lean<ResidentRecord | null>();

  if (!resident) {
    return;
  }

  const [hostelName, contact] = await Promise.all([
    getHostelName(payment.hostelId),
    resolveResidentContact(resident),
  ]);
  const paymentsUrl = appUrl("/resident/payments");

  const email =
    outcome.kind === "verified"
      ? paymentVerifiedEmail({
          amount: outcome.verifiedAmount,
          hostelName,
          month: payment.month,
          paymentsUrl,
          receiptNumber: outcome.receiptNumber,
          remainingAmount: Math.max(payment.dueAmount - payment.paidAmount, 0),
          residentName: contact?.name ?? resident.firstName,
        })
      : paymentRejectedEmail({
          hostelName,
          month: payment.month,
          paymentsUrl,
          rejectionReason: outcome.rejectionReason,
          residentName: contact?.name ?? resident.firstName,
        });

  if (resident.userId) {
    await createInAppNotification({
      body:
        outcome.kind === "verified"
          ? `Your payment for ${payment.month} was verified. Receipt ${outcome.receiptNumber}.`
          : `Your payment proof for ${payment.month} was not accepted: ${outcome.rejectionReason}`,
      category: "PAYMENT",
      data: { paymentId: payment._id.toString() },
      hostelId: payment.hostelId.toString(),
      title: outcome.kind === "verified" ? "Payment verified" : "Payment proof rejected",
      userId: resident.userId.toString(),
    });
  }

  if (contact) {
    await sendNotificationEmail({
      action: `payment_${outcome.kind}`,
      html: email.html,
      subject: email.subject,
      to: contact.email,
    });
  }
}

export async function rejectPaymentProof(
  proofId: string,
  input: PaymentProofReviewInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  if (!input.rejectionReason) {
    throw new PaymentServiceError(
      "A rejection reason is required.",
      "REJECTION_REASON_REQUIRED",
      422,
    );
  }

  const proof = await findAdminPaymentProof(proofId, principal, input.hostelId);
  const now = new Date();

  // Rejecting a proof that was already approved would reopen a settled month
  // while its paidAmount stayed put, so only PENDING proofs may be rejected.
  assertProofIsPending(proof);

  const payment = await PaymentModel.findOne({
    _id: proof.paymentId,
    hostelId: proof.hostelId,
  }).lean<PaymentRecord | null>();

  if (!payment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  const reviewedProof = await PaymentProofModel.findOneAndUpdate(
    { _id: proof._id, status: "PENDING" },
    {
      $set: {
        rejectionReason: input.rejectionReason,
        reviewedAt: now,
        reviewedBy: principal.userId,
        status: "REJECTED",
      },
    },
    { new: true },
  ).lean<PaymentProofRecord | null>();

  if (!reviewedProof) {
    throw alreadyReviewedError();
  }

  const nextStatus: PaymentStatus = payment.paidAmount > 0 ? "PARTIAL" : "UNPAID";
  const updatedPayment = await PaymentModel.findOneAndUpdate(
    { _id: payment._id },
    { $set: { status: nextStatus, updatedBy: principal.userId } },
    { new: true },
  ).lean<PaymentRecord | null>();

  if (!updatedPayment) {
    throw new PaymentServiceError("Payment was not found.", "PAYMENT_NOT_FOUND", 404);
  }

  await auditPaymentAction(
    principal,
    proof.hostelId,
    proof._id,
    "PaymentProof",
    "PAYMENT_PROOF_REJECTED",
    { paymentId: proof.paymentId.toString(), reason: input.rejectionReason },
  );

  await notifyResidentOfReview(updatedPayment, {
    kind: "rejected",
    rejectionReason: input.rejectionReason,
  });

  return {
    payment: serializePayment(updatedPayment),
    proof: serializePaymentProof(reviewedProof),
  };
}

/**
 * Sets the recurring fee on residents in scope. Returns how many were updated
 * so the caller can confirm a bulk change actually landed.
 */
export async function setResidentMonthlyFee(
  input: ResidentFeeUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const filter: Record<string, unknown> = {
    hostelId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "PENDING"] },
  };

  if (input.residentIds?.length) {
    filter._id = {
      $in: input.residentIds.map((id) => normalizeObjectId(id, "resident id")),
    };
  }

  const result = await ResidentModel.updateMany(filter, {
    $set: { monthlyFee: input.monthlyFee, updatedBy: principal.userId },
  });

  await auditPaymentAction(
    principal,
    hostelId,
    hostelId,
    "Resident",
    "RESIDENT_MONTHLY_FEE_SET",
    { monthlyFee: input.monthlyFee, residentCount: result.modifiedCount },
  );

  return { monthlyFee: input.monthlyFee, updatedCount: result.modifiedCount ?? 0 };
}

/**
 * Creates the month's payment record for each active resident in scope.
 * Idempotent: residents that already have a record for `month` are skipped, so
 * a repeated fee run (or a re-run after adding residents) never double-bills.
 */
export async function generateMonthlyPayments(
  input: MonthlyPaymentGenerateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const filter: Record<string, unknown> = {
    hostelId,
    isDeleted: false,
    status: "ACTIVE",
  };

  if (input.residentIds?.length) {
    filter._id = {
      $in: input.residentIds.map((id) => normalizeObjectId(id, "resident id")),
    };
  }

  const residents =
    await ResidentModel.find(filter).lean<(ResidentRecord & { monthlyFee?: number })[]>();
  const existing = await PaymentModel.find({
    hostelId,
    month: input.month,
    residentId: { $in: residents.map((resident) => resident._id) },
  }).lean<{ residentId: Types.ObjectId }[]>();
  const alreadyBilled = new Set(existing.map((payment) => payment.residentId.toString()));

  const pending = residents.filter(
    (resident) => !alreadyBilled.has(resident._id.toString()),
  );
  const billable = pending
    .map((resident) => ({
      dueAmount: resident.monthlyFee || input.defaultAmount || 0,
      resident,
    }))
    .filter((entry) => entry.dueAmount > 0);

  if (billable.length > 0) {
    await PaymentModel.insertMany(
      billable.map((entry) => ({
        createdBy: principal.userId,
        dueAmount: entry.dueAmount,
        dueDate: input.dueDate,
        hostelId,
        month: input.month,
        paidAmount: 0,
        residentId: entry.resident._id,
        status: "UNPAID",
        updatedBy: principal.userId,
      })),
    );
  }

  await auditPaymentAction(
    principal,
    hostelId,
    hostelId,
    "Payment",
    "MONTHLY_PAYMENTS_GENERATED",
    { created: billable.length, month: input.month },
  );

  return {
    createdCount: billable.length,
    month: input.month,
    skippedExistingCount: alreadyBilled.size,
    /** Active residents with neither a personal fee nor a default to fall back on. */
    skippedNoFeeCount: pending.length - billable.length,
  };
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return { daysInMonth, end, start };
}

function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The month's due for one resident. A mid-month move-in owes only the days
 * from move-in to month end, pro-rated by calendar days; from the following
 * month they owe the full fee. Residents who move in after the month ends owe
 * nothing for it.
 */
export function computeMonthlyDue(monthlyFee: number, moveInDate: Date, month: string) {
  const { daysInMonth, end, start } = monthBounds(month);

  if (moveInDate > end) {
    return 0;
  }

  if (moveInDate <= start) {
    return monthlyFee;
  }

  const billableDays = daysInMonth - moveInDate.getUTCDate() + 1;

  return Math.round((monthlyFee / daysInMonth) * billableDays);
}

/**
 * Paid/partial/unpaid view of a month for every resident, auto-generating the
 * missing payment rows first (current or past months only — never bills the
 * future). Row generation is idempotent per (residentId, month).
 */
export async function getMonthlyPaymentMatrix(
  query: PaymentMatrixQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, query.hostelId);
  const month = query.month ?? currentMonth();
  const { end } = monthBounds(month);
  const now = new Date();

  const residents = await ResidentModel.find({
    hostelId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "PENDING"] },
  }).lean<(ResidentRecord & { monthlyFee?: number })[]>();

  // Lazily create this month's rows so the matrix is always current without a
  // manual fee run. Future months are viewable but never auto-billed.
  if (month <= currentMonth()) {
    const existing = await PaymentModel.find({
      hostelId,
      month,
      residentId: { $in: residents.map((resident) => resident._id) },
    }).lean<{ residentId: Types.ObjectId }[]>();
    const billed = new Set(existing.map((payment) => payment.residentId.toString()));

    const toCreate = residents
      .map((resident) => ({
        dueAmount: computeMonthlyDue(
          resident.monthlyFee ?? 0,
          resident.moveInDate,
          month,
        ),
        resident,
      }))
      .filter(
        (entry) => entry.dueAmount > 0 && !billed.has(entry.resident._id.toString()),
      );

    if (toCreate.length > 0) {
      await PaymentModel.insertMany(
        toCreate.map((entry) => ({
          createdBy: principal.userId,
          dueAmount: entry.dueAmount,
          dueDate: end,
          hostelId,
          month,
          paidAmount: 0,
          residentId: entry.resident._id,
          status: "UNPAID",
          updatedBy: principal.userId,
        })),
        // Parallel matrix loads can race on the same resident+month; the
        // unique index wins and unordered inserts keep the rest.
        { ordered: false },
      ).catch((error: { code?: number }) => {
        if (error?.code !== 11000) {
          throw error;
        }
      });
    }
  }

  const payments = await PaymentModel.find({ hostelId, month }).lean<PaymentRecord[]>();
  const paymentByResident = new Map(
    payments.map((payment) => [payment.residentId.toString(), payment]),
  );

  // MOVED_OUT residents keep their historical rows visible for the month.
  const extraResidentIds = payments
    .map((payment) => payment.residentId)
    .filter((id) => !residents.some((resident) => resident._id.equals(id)));
  const extraResidents = extraResidentIds.length
    ? await ResidentModel.find({ _id: { $in: extraResidentIds } }).lean<
        (ResidentRecord & { monthlyFee?: number })[]
      >()
    : [];

  const rows = [...residents, ...extraResidents].map((resident) => {
    const payment = paymentByResident.get(resident._id.toString()) ?? null;
    const displayStatus = payment
      ? payment.status === "UNPAID" && payment.dueDate < now
        ? "OVERDUE"
        : payment.status
      : "NOT_BILLED";

    return {
      displayStatus,
      payment: payment ? serializePayment(payment) : null,
      resident: serializeResidentSummary(resident),
    };
  });

  rows.sort((a, b) =>
    `${a.resident.firstName} ${a.resident.lastName}`.localeCompare(
      `${b.resident.firstName} ${b.resident.lastName}`,
    ),
  );

  const totals = {
    collected: rows.reduce((sum, row) => sum + (row.payment?.paidAmount ?? 0), 0),
    due: rows.reduce((sum, row) => sum + (row.payment?.dueAmount ?? 0), 0),
    notBilled: rows.filter((row) => row.displayStatus === "NOT_BILLED").length,
    overdue: rows.filter((row) => row.displayStatus === "OVERDUE").length,
    paid: rows.filter((row) => row.displayStatus === "PAID").length,
    partial: rows.filter((row) => row.displayStatus === "PARTIAL").length,
    unpaid: rows.filter(
      (row) => row.displayStatus === "UNPAID" || row.displayStatus === "PENDING_PROOF",
    ).length,
  };

  return { month, rows, totals };
}

export async function getResidentReceipt(receiptId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const receipt = await ReceiptModel.findOne({
    _id: normalizeObjectId(receiptId, "receipt id"),
    hostelId: resident.hostelId,
    residentId: resident._id,
  }).lean<ReceiptRecord | null>();

  if (!receipt) {
    throw new PaymentServiceError("Receipt was not found.", "RECEIPT_NOT_FOUND", 404);
  }

  return {
    receipt: serializeReceipt(receipt),
    resident: serializeResidentSummary(resident),
  };
}
