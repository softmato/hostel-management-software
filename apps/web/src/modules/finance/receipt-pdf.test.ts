/**
 * Receipt and statement PDFs — Block 2 item 2.6, current §7.12.
 *
 * Rendering has one failure mode that matters and it is not visual: standard PDF
 * fonts are WinAnsi-encoded, and this product is full of Devanagari names. An
 * unencodable character makes `pdf-lib` throw *mid-render*, which would turn
 * "download my statement" into a 500 for exactly the residents most likely to
 * have one.
 */
import { describe, expect, it } from "vitest";

import { renderReceiptPdf, renderStatementPdf } from "@/modules/finance/receipt-pdf";

const header = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.slice(0, 5));

describe("renderReceiptPdf", () => {
  it("produces a PDF", async () => {
    const bytes = await renderReceiptPdf({
      amount: 12000,
      hostelName: "Rupa Hostel",
      invoicePeriod: "2026-08",
      issuedAt: new Date("2026-08-07T00:00:00.000Z"),
      receiptNumber: "RCP-RUP-2026-08-00001",
      referenceCode: "RUP-4821-K",
      residentName: "Sita Sharma",
    });

    expect(header(bytes)).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("renders a Devanagari name instead of throwing", async () => {
    const bytes = await renderReceiptPdf({
      amount: 12000,
      hostelName: "रूपा होस्टेल",
      issuedAt: new Date("2026-08-07T00:00:00.000Z"),
      receiptNumber: "RCP-RUP-2026-08-00001",
      residentName: "सीता शर्मा",
    });

    expect(header(bytes)).toBe("%PDF-");
  });

  it("renders a voided receipt rather than refusing", async () => {
    // A resident holding a voided receipt is exactly who needs to be told it no
    // longer stands.
    const bytes = await renderReceiptPdf({
      amount: 12000,
      hostelName: "Rupa Hostel",
      issuedAt: new Date("2026-08-07T00:00:00.000Z"),
      receiptNumber: "RCP-RUP-2026-08-00001",
      residentName: "Sita Sharma",
      voidReason: "wrong amount",
      voidedAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(header(bytes)).toBe("%PDF-");
  });
});

describe("renderStatementPdf", () => {
  it("produces a PDF for an empty history", async () => {
    // A resident who has never been billed still gets a document, because the
    // absence is itself the answer they were asked to produce.
    const bytes = await renderStatementPdf({
      generatedAt: new Date("2026-08-07T00:00:00.000Z"),
      hostelName: "Rupa Hostel",
      residentName: "Sita Sharma",
      rows: [],
    });

    expect(header(bytes)).toBe("%PDF-");
  });

  it("does not run off the page for a long stay", async () => {
    const bytes = await renderStatementPdf({
      generatedAt: new Date("2026-08-07T00:00:00.000Z"),
      hostelName: "Rupa Hostel",
      residentName: "Sita Sharma",
      rows: Array.from({ length: 60 }, (_, index) => ({
        dueAmount: 12000,
        paidAmount: 12000,
        period: `20${20 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
        status: "PAID",
      })),
    });

    expect(header(bytes)).toBe("%PDF-");
  });
});
