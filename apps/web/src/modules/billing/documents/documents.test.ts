import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bsFiscalYear } from "@hostel/shared/calendar/bs";

import { amountInWords } from "./amount-in-words";
import {
  documentAdDate,
  documentAmount,
  documentBsDate,
  documentInstant,
  type Issuer,
} from "./document-parts";
import { renderInvoiceDocument } from "./invoice-document";
import { renderReceiptDocument } from "./receipt-document";

/**
 * The documents, and the three things on them that can be wrong silently.
 *
 * A PDF's *layout* cannot be asserted here in any way that would be worth the
 * assertion — a test that checks a byte length or a glyph position fails on
 * every deliberate change and catches nothing, so the page design is verified
 * by opening the fixtures these tests write. What is asserted is the content
 * that a reader cannot check for themselves: the fiscal year the number is
 * stamped with, the words line under the figure, and the fact that both
 * renderers produce a real, openable PDF for the awkward inputs.
 *
 * The fixtures are written as a side effect on purpose. A renderer with no way
 * to see its output is a renderer nobody looks at, and these two documents are
 * the parent company's stationery — the only meaningful review of them is
 * visual.
 */

const ISSUER: Issuer = {
  address: "Kathmandu, Nepal",
  email: "info@softmato.com",
  legalName: "Softmato Technology Private Limited",
  pan: "623692242",
  phone: "9709155982",
  productName: "HostelPalika",
  vatRegistered: false,
};

/** 2 Sept 2026, 10:00 NPT — 17 Bhadra 2083, in fiscal year 2083/84. */
const MOMENT = new Date("2026-09-02T04:15:00.000Z");

const FIXTURES = path.resolve(__dirname, "../../../../../../fixtures");

function writeFixture(name: string, bytes: Uint8Array) {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(path.join(FIXTURES, name), bytes);
}

/** Every PDF begins `%PDF-` and ends with an `%%EOF` trailer. */
function isPdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  const tail = Buffer.from(bytes.slice(-1024)).toString("latin1");

  return head === "%PDF-" && tail.includes("%%EOF");
}

describe("amountInWords", () => {
  it("spells the receipt's own example", () => {
    expect(amountInWords(150)).toBe("One Hundred Fifty Rupees Only");
  });

  it("spells the invoice's own example", () => {
    expect(amountInWords(100)).toBe("One Hundred Rupees Only");
  });

  it("groups by lakh, not by million", () => {
    expect(amountInWords(150_000)).toBe("One Lakh Fifty Thousand Rupees Only");
    expect(amountInWords(1_000_000)).toBe("Ten Lakh Rupees Only");
  });

  it("groups by crore above a hundred lakh", () => {
    expect(amountInWords(12_500_000)).toBe(
      "One Crore Twenty Five Lakh Rupees Only",
    );
  });

  it("handles the teens, which are not tens-plus-ones", () => {
    expect(amountInWords(19)).toBe("Nineteen Rupees Only");
    expect(amountInWords(15_000)).toBe("Fifteen Thousand Rupees Only");
  });

  it("carries every group at once", () => {
    expect(amountInWords(11_11_111)).toBe(
      "Eleven Lakh Eleven Thousand One Hundred Eleven Rupees Only",
    );
  });

  it("says zero out loud rather than returning an empty line", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
  });

  it("refuses a fraction rather than rounding it", () => {
    // A words line that disagrees with the figure above it defeats its only
    // purpose, so this throws where `Math.round` would have been silent.
    expect(() => amountInWords(150.5)).toThrow(/whole/i);
  });

  it("refuses a negative amount", () => {
    expect(() => amountInWords(-1)).toThrow();
  });

  it("refuses past the last word it knows", () => {
    expect(() => amountInWords(10_000_000_000)).toThrow(/Arab/);
  });
});

describe("bsFiscalYear", () => {
  it("names the year the supplied documents were issued in", () => {
    expect(bsFiscalYear(MOMENT)).toBe("2083/84");
  });

  it("opens the year on Shrawan 1, not on Baisakh 1", () => {
    // 16 July 2026 is Asar 2083 — the *end* of 2082/83. A day later is Shrawan.
    expect(bsFiscalYear(new Date("2026-07-16T06:00:00.000Z"))).toBe("2082/83");
    expect(bsFiscalYear(new Date("2026-07-17T06:00:00.000Z"))).toBe("2083/84");
  });

  it("keeps a Chaitra date in the fiscal year that began the previous July", () => {
    // Chaitra 2083 is April 2027 — still 2083/84, because Asar has not ended.
    expect(bsFiscalYear(new Date("2027-04-05T06:00:00.000Z"))).toBe("2083/84");
  });

  it("prints two digits for the closing year, as Nepali tax paper does", () => {
    expect(bsFiscalYear(MOMENT)).not.toContain("2084");
  });

  it("returns an empty string rather than guessing at a missing date", () => {
    expect(bsFiscalYear(null)).toBe("");
  });
});

describe("document formatting", () => {
  it("writes a Nepali date day-first, the way a receipt book does", () => {
    expect(documentBsDate(MOMENT)).toBe("17 Bhadra 2083 BS");
  });

  it("translates it into the Gregorian date beside it", () => {
    expect(documentAdDate(MOMENT)).toBe("2 Sept 2026");
  });

  it("stamps a payment with the time in Nepal, not in the server's zone", () => {
    expect(documentInstant(MOMENT)).toBe("2 Sept 2026, 10:00 am NPT");
  });

  it("always shows the paisa column, even when it is empty", () => {
    expect(documentAmount(150)).toBe("150.00");
  });

  it("groups a large figure the way the words line under it breaks", () => {
    expect(documentAmount(150_000)).toBe("1,50,000.00");
  });
});

describe("renderInvoiceDocument", () => {
  const base = {
    amountPaid: 0,
    billedTo: {
      email: "adhikaresiddhant@gmail.com",
      name: "Siddhant Adhikari",
    },
    currency: "NPR",
    documentNumber: "HH-INV-2083/84-000012",
    issuedAt: MOMENT,
    issuer: ISSUER,
    lines: [
      {
        amount: 100,
        description: "Sandbox payment test",
        period: null,
        quantity: 1,
        rate: 100,
      },
    ],
    paymentMethods: ["Khalti", "eSewa", "Bank transfer"],
    presentation: {
      billingPeriod: "12 months",
      features: [
        "Up to 500 beds across unlimited properties",
        "Guest check-in and check-out from a phone",
        "Nightly off-site backups, restorable to any point in 30 days",
        "Staff accounts with per-role permissions",
      ],
      highlights: ["Priority support", "Free onboarding"],
      planName: "HostelPalika Growth — Annual · 12 months",
      tagline: "For properties running more than one building.",
    },
    status: "UNPAID" as const,
  };

  it("renders an openable PDF, and leaves it to be looked at", async () => {
    const bytes = await renderInvoiceDocument(base);

    expect(isPdf(bytes)).toBe(true);
    writeFixture("subscription-invoice.pdf", bytes);
  });

  it("renders with no plan block, which is what a deleted tier leaves", async () => {
    const bytes = await renderInvoiceDocument({ ...base, presentation: null });

    expect(isPdf(bytes)).toBe(true);
  });

  it("renders a part-paid invoice", async () => {
    const bytes = await renderInvoiceDocument({
      ...base,
      amountPaid: 40,
      status: "PARTLY PAID",
    });

    expect(isPdf(bytes)).toBe(true);
    writeFixture("subscription-invoice-partial.pdf", bytes);
  });

  it("renders a multi-line invoice at a real plan price", async () => {
    const bytes = await renderInvoiceDocument({
      ...base,
      lines: [
        {
          amount: 96_000,
          description: "HostelPalika Growth — annual plan",
          period: "2083-05",
          quantity: 12,
          rate: 8_000,
        },
      ],
      status: "PAID",
    });

    expect(isPdf(bytes)).toBe(true);
  });
});

describe("renderReceiptDocument", () => {
  const base = {
    amount: 150,
    currency: "NPR",
    documentNumber: "HH-TXN-2083/84-00000008",
    invoiceNumber: "HH-INV-2083/84-000011",
    invoiceTotal: 150,
    issuer: ISSUER,
    method: "eSewa",
    paidAt: MOMENT,
    receivedFrom: {
      email: "adhikaresiddhant@gmail.com",
      name: "Siddhant Adhikari",
    },
    reference: "SRC-0001-4F2A",
    totalReceived: 150,
    transactionId: "000GYAH",
  };

  it("renders an openable PDF, and leaves it to be looked at", async () => {
    const bytes = await renderReceiptDocument(base);

    expect(isPdf(bytes)).toBe(true);
    writeFixture("subscription-receipt.pdf", bytes);
  });

  it("renders a cash receipt, which has no gateway reference", async () => {
    const bytes = await renderReceiptDocument({
      ...base,
      method: "Cash",
      transactionId: null,
    });

    expect(isPdf(bytes)).toBe(true);
  });

  it("renders a part payment, which still leaves a balance", async () => {
    const bytes = await renderReceiptDocument({
      ...base,
      amount: 60,
      invoiceTotal: 150,
      totalReceived: 60,
    });

    expect(isPdf(bytes)).toBe(true);
    writeFixture("subscription-receipt-partial.pdf", bytes);
  });
});
