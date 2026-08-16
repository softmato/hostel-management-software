import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { getCreditAmount } from "@/modules/finance/credit-balance.service";
import {
  listRecentInvoices,
  listResidentInvoices,
} from "@/modules/finance/ledger-read.service";
import type { LedgerInvoice } from "@/modules/finance/ledger-read.service";
import { listReviewQueue } from "@/modules/finance/review.service";
import { findCurrentResident } from "@/modules/residents/resident-access";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { ReceiptModel } from "@hostel/db/models/Receipt";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * Invoice lists for the two portals (plan item 2.8).
 *
 * Replaces `listPayments`, `listResidentPayments` and `getMonthlyPaymentMatrix`.
 * All three read through the ledger facade rather than a model, so the screens
 * are already source-agnostic.
 *
 * The matrix keeps its shape — one row per resident, billed or not — because
 * that shape is genuinely useful: "who has not paid" is the question an owner
 * opens the screen to answer. What it loses is the lazy insert that made
 * *rendering* it a billing event (item 2.5). A resident with no invoice now
 * shows as `NOT_BILLED`, which is the truth rather than a gap the page quietly
 * filled in.
 */

/**
 * An invoice in the portal's own vocabulary.
 *
 * `month`, not `period` — every other consumer of the facade renames it in its
 * own serializer (`report.service`, `guardian.service`,
 * `resident-dashboard.service`, `report-export.service` all do), because the
 * screens have said `month` since they were built. Returning `period` raw here
 * would have rendered five blank cells on the resident's payments page while
 * type-checking perfectly, since the response type is a caller-side generic.
 * Block 3 renames the screens and this mapping goes with it.
 */
export type PortalInvoice = {
  dueAmount: number;
  dueDate?: Date;
  id: string;
  method?: string;
  month: string;
  paidAmount: number;
  paidDate?: Date;
  status: string;
};

export function toPortalInvoice(invoice: LedgerInvoice): PortalInvoice {
  return {
    dueAmount: invoice.dueAmount,
    dueDate: invoice.dueDate,
    id: invoice.id,
    method: invoice.method,
    month: invoice.period,
    paidAmount: invoice.paidAmount,
    paidDate: invoice.paidDate,
    status: invoice.status,
  };
}

/** One receipt on a resident's month, as their screen lists it. */
export type ResidentInvoiceReceipt = {
  amount: number;
  id: string;
  issuedAt: string | null;
  number: string;
};

/**
 * An invoice as the resident's own screen needs it.
 *
 * `receipts` is the one addition: a settled month has receipts, and a resident
 * who needs proof of rent for a visa or a landlord should be one tap from the
 * PDF rather than emailing the hostel for it. The admin matrix has no use for
 * them, so they live on this shape instead of `PortalInvoice`.
 *
 * **All of them, not the newest.** There is one receipt per settled *payment*,
 * not per month, so a resident who paid NPR 60 and then the remaining NPR 1,230
 * has two — and returning only the latest quietly made the first unreachable the
 * moment the second was issued. The screen showed a single chip whose number
 * changed under a row whose `Paid` column had gone up, which is exactly the
 * question this page keeps getting asked: *did my earlier payment survive?*
 * Newest first, because the last thing they paid is the thing they are looking
 * for.
 */
export type ResidentPortalInvoice = PortalInvoice & {
  receipts: ResidentInvoiceReceipt[];
  /**
   * The invoice's reference code (§5, ADR-7), so the payments page can show the
   * resident the code for the month they owe without opening the pay screen.
   *
   * The commonest way to pay without a code is never to have seen one: the code
   * lived only behind `Pay now`, and a resident who pays from their banking app
   * out of habit never opens that screen. It is not on `PortalInvoice` because
   * the admin matrix has no use for it, and it is read here rather than through
   * the ledger facade because the facade describes balances, not identifiers.
   */
  referenceCode: string | null;
};

export type ResidentFinanceView = {
  claims: Awaited<ReturnType<typeof listReviewQueue>>;
  /**
   * Credit carried from an earlier overpayment (target §9.4). Zero for almost
   * everyone, and the screen shows it only when it is not — but when it is, the
   * resident has to be told, or the next invoice arrives mysteriously smaller.
   */
  credit: number;
  invoices: ResidentPortalInvoice[];
};

export async function getResidentFinanceView(
  principal: ApiPrincipal,
): Promise<ResidentFinanceView> {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  const [invoices, claims, credit] = await Promise.all([
    listResidentInvoices({ hostelId: resident.hostelId, residentId: resident._id }),
    listResidentClaims(resident.hostelId, resident._id),
    getCreditAmount(resident.hostelId, resident._id),
  ]);

  const codeRows = invoices.length
    ? await InvoiceModel.find({
        _id: { $in: invoices.map((invoice) => invoice.id) },
        residentId: resident._id,
      })
        .select("referenceCode")
        .lean<{ _id: Types.ObjectId; referenceCode?: string }[]>()
    : [];

  const codeByInvoice = new Map(
    codeRows.map((row) => [row._id.toString(), row.referenceCode ?? null]),
  );

  // Voided receipts are excluded: a receipt that was voided when its payment was
  // reversed must not stay downloadable, or the resident keeps a document
  // asserting a payment the ledger no longer counts.
  const receipts = invoices.length
    ? await ReceiptModel.find({
        invoiceId: { $in: invoices.map((invoice) => invoice.id) },
        residentId: resident._id,
        voidedAt: null,
      })
        .select("amount invoiceId issuedAt receiptNumber")
        .sort({ issuedAt: -1 })
        .lean<
          {
            _id: Types.ObjectId;
            amount: number;
            invoiceId?: Types.ObjectId | null;
            issuedAt?: Date | null;
            receiptNumber: string;
          }[]
        >()
    : [];

  // Sorted newest first above, and appended in that order, so each month's list
  // reads most-recent-first without a second sort.
  const receiptsByInvoice = new Map<string, ResidentInvoiceReceipt[]>();

  for (const receipt of receipts) {
    const key = receipt.invoiceId?.toString();

    if (!key) continue;

    const list = receiptsByInvoice.get(key) ?? [];

    list.push({
      amount: receipt.amount,
      id: receipt._id.toString(),
      issuedAt: receipt.issuedAt?.toISOString() ?? null,
      number: receipt.receiptNumber,
    });
    receiptsByInvoice.set(key, list);
  }

  return {
    claims,
    credit,
    invoices: invoices.map((invoice) => {
      const portal = toPortalInvoice(invoice);

      return {
        ...portal,
        receipts: receiptsByInvoice.get(portal.id) ?? [],
        referenceCode: codeByInvoice.get(portal.id) ?? null,
      };
    }),
  };
}

/**
 * A resident's own claims, so their screen can show "waiting for review" against
 * the invoice it belongs to. Reuses the queue's row shape rather than inventing
 * a second one — it is the same record seen from the other side.
 */
async function listResidentClaims(
  hostelId: Types.ObjectId,
  residentId: Types.ObjectId,
): Promise<Awaited<ReturnType<typeof listReviewQueue>>> {
  const [pending, settled, rejected] = await Promise.all([
    listReviewQueue(hostelId, "PENDING"),
    listReviewQueue(hostelId, "SETTLED"),
    listReviewQueue(hostelId, "REJECTED"),
  ]);

  const mine = residentId.toString();

  return [...pending, ...settled, ...rejected].filter(
    (claim) => claim.residentId === mine,
  );
}

/**
 * One row of the matrix.
 *
 * `payment` and `resident`, not `invoice` and `residentId`: this is the shape
 * the admin screen already renders, and keeping it is the same decision as the
 * facade's vocabulary — the models changed underneath, the screens change in
 * Block 3, and not on the same day.
 */
type ResidentRow = {
  _id: Types.ObjectId;
  bedType?: string;
  firstName?: string;
  lastName?: string;
  moveInDate?: Date;
  phone?: string;
  roomNumber?: string;
  roomType?: string;
};

export type InvoiceMatrixRow = {
  displayStatus: string;
  payment: PortalInvoice | null;
  resident: {
    fullName: string;
    id: string;
    moveInDate: string;
    phone?: string;
    roomNumber?: string | null;
    /**
     * The identifying attribute the hostel actually thinks in (target §11.4:
     * "bed type replaces room number throughout"). `bedType` is the canonical
     * pricing vocabulary and `roomType` is what the resident was registered
     * with, so we prefer the former and fall back to the latter for residents
     * registered before the derivation existed.
     */
    roomType?: string | null;
  };
};

export type InvoiceMatrix = {
  month: string;
  rows: InvoiceMatrixRow[];
  totals: {
    collected: number;
    due: number;
    notBilled: number;
    overdue: number;
    paid: number;
    partial: number;
    unpaid: number;
  };
};

/**
 * One row per resident for a period, billed or not.
 *
 * **Read-only.** This is the function whose predecessor created a `Payment` row
 * for every unbilled resident as a side effect of being called, so two residents
 * could be billed differently depending on which screen an admin opened first.
 */
export async function getInvoiceMatrix(
  hostelId: Types.ObjectId | string,
  period: string,
): Promise<InvoiceMatrix> {
  await connectToDatabase();

  const [residents, invoices] = await Promise.all([
    ResidentModel.find({
      hostelId,
      isDeleted: { $ne: true },
      status: { $in: ["ACTIVE", "PENDING"] },
    })
      .select("bedType firstName lastName moveInDate phone roomNumber roomType")
      .lean<ResidentRow[]>(),
    InvoiceModel.find({ hostelId, period, status: { $ne: "VOID" } }).lean<
      {
        _id: Types.ObjectId;
        dueDate?: Date;
        period: string;
        residentId: Types.ObjectId;
        status: string;
        totalAmount: number;
      }[]
    >(),
  ]);

  const balances = await listRecentInvoices({ hostelId, period }, 1000);
  const balanceByInvoiceId = new Map(balances.map((row) => [row.id, row]));

  const invoiceByResident = new Map(
    invoices.map((invoice) => [
      invoice.residentId.toString(),
      balanceByInvoiceId.get(invoice._id.toString()) ?? null,
    ]),
  );

  // Residents who left mid-period keep their row: they were billed, and hiding
  // the invoice would hide money that is still owed.
  //
  // **A soft-deleted resident is not one of them.** This lookup used to have no
  // `isDeleted` guard, so a deleted resident with an open invoice was pulled
  // back onto the screen — the matrix listed two people while every other
  // surface, which filters properly, counted one. Deletion means gone from the
  // product, not gone unless they happen to owe money.
  const extraIds = invoices
    .map((invoice) => invoice.residentId.toString())
    .filter((id) => !residents.some((resident) => resident._id.toString() === id));

  const extras = extraIds.length
    ? await ResidentModel.find({ _id: { $in: extraIds }, isDeleted: { $ne: true } })
        .select("bedType firstName lastName moveInDate phone roomNumber roomType")
        .lean<ResidentRow[]>()
    : [];

  const rows: InvoiceMatrixRow[] = [...residents, ...extras].map((resident) => {
    const invoice = invoiceByResident.get(resident._id.toString()) ?? null;

    return {
      displayStatus: invoice?.status ?? "NOT_BILLED",
      payment: invoice ? toPortalInvoice(invoice) : null,
      resident: {
        fullName: `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim(),
        id: resident._id.toString(),
        // The screen flags a mid-month move-in as pro-rated by comparing this
        // against the period, so it has to be an ISO string, not a Date.
        moveInDate: resident.moveInDate?.toISOString() ?? "",
        phone: resident.phone,
        roomNumber: resident.roomNumber ?? null,
        roomType: resident.bedType ?? resident.roomType ?? null,
      },
    };
  });

  rows.sort((left, right) => left.resident.fullName.localeCompare(right.resident.fullName));

  const countOf = (status: string) =>
    rows.filter((row) => row.displayStatus === status).length;

  return {
    month: period,
    rows,
    totals: {
      collected: rows.reduce((sum, row) => sum + (row.payment?.paidAmount ?? 0), 0),
      due: rows.reduce((sum, row) => sum + (row.payment?.dueAmount ?? 0), 0),
      notBilled: countOf("NOT_BILLED"),
      overdue: countOf("OVERDUE"),
      paid: countOf("PAID"),
      partial: countOf("PARTIAL"),
      unpaid: countOf("UNPAID") + countOf("PENDING_PROOF"),
    },
  };
}
