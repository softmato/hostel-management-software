/**
 * Builds the synthetic half of the evidence golden set.
 *
 * ## What this is for, and what it must never be used for
 *
 * The engine swap needs a number: how often does each recogniser get the
 * amount, the transaction id, the direction and the outcome *all* right on one
 * file. You cannot get that number without ground truth, and you cannot get
 * ground truth from a folder of real receipts without a person reading every one
 * of them by hand. So this renders receipts whose answers are known because they
 * were written in.
 *
 * **This does not derive layouts, and must not be read as evidence that a layout
 * is right.** This project has already paid for that mistake once: the statement
 * parsers passed against invented fixtures and broke on four real exports the
 * first time anyone tried one. The labels below are copied from the templates in
 * `evidence-receipt.ts`, which *were* derived from real receipts, and the only
 * claim made for them is that they use the same vocabulary. A real receipt in
 * `manifest.json` outranks anything here, always.
 *
 * What synthetic files are genuinely good for is the part real files cannot
 * cover: the same receipt under controlled degradation. A resident's receipt
 * arrives cropped, re-compressed by WhatsApp, in dark mode, photographed at an
 * angle, or all four — and to know which of those an engine survives you need
 * the *same* content in each state, which no collection of real files provides.
 *
 * Usage:
 *   node --experimental-transform-types --import ./scripts/register-ts-hook.mjs \
 *     scripts/make-evidence-fixtures.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp, { type Sharp } from "sharp";

/** Where the corpus lives. Gitignored — see the note at the bottom of the file. */
const OUT_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "evidence-golden",
);

type GroundTruth = {
  amount: number;
  direction: "CREDIT" | "DEBIT" | "UNKNOWN";
  isPaymentReceipt: boolean;
  outcome: "FAILED" | "PENDING" | "SUCCESS" | "UNKNOWN";
  payee: string | null;
  provider: string;
  referenceCode: string | null;
  txnId: string | null;
};

type Row = { emphasis?: boolean; label: string; value: string };

type Layout = {
  /** The coloured brand word at the top. Never a real brand colour — see below. */
  brand: string;
  headline: string;
  id: string;
  rows: Row[];
  truth: GroundTruth;
};

/**
 * The layouts.
 *
 * Field labels come from `evidence-receipt.ts`'s templates. The values are
 * invented and deliberately distinctive — `8823119471` is the id from the bug
 * report that started this work, so a scorer regression on it is recognisable.
 */
const LAYOUTS: Layout[] = [
  {
    brand: "eSewa",
    headline: "NPR 2,000.00",
    id: "esewa-transfer",
    rows: [
      { label: "Paid to", value: "Education Light Hostel" },
      { label: "Paid by", value: "9841000000" },
      { label: "Transaction Code", value: "8823119471" },
      { label: "Date", value: "2026-09-05 16:02" },
      { label: "Remarks", value: "EDU-000D-6" },
      { label: "Status", value: "COMPLETE" },
    ],
    truth: {
      amount: 2000,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "Education Light Hostel",
      provider: "ESEWA",
      referenceCode: "EDU-000D-6",
      txnId: "8823119471",
    },
  },
  {
    brand: "Khalti",
    headline: "Rs. 8,500",
    id: "khalti-merchant",
    rows: [
      { label: "Merchant Name", value: "Sunrise Boys Hostel" },
      { label: "Mobile", value: "9812345678" },
      { label: "Purchase Order ID", value: "KHLT2026090512345" },
      { label: "Product Name", value: "Rent Bhadra" },
      { label: "Date", value: "05 Sep 2026" },
      { label: "Status", value: "Completed" },
    ],
    truth: {
      amount: 8500,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "Sunrise Boys Hostel",
      provider: "KHALTI",
      referenceCode: null,
      txnId: "KHLT2026090512345",
    },
  },
  {
    /*
     * A Fonepay QR payment as the payer actually sees it.
     *
     * The layout this replaced was invented, and it depicted a document that
     * does not exist: a standalone Fonepay receipt with `Merchant Name`, `Trace
     * ID` and `Narration` rows. Fonepay issues the payer nothing. A customer
     * scans the QR inside **their own bank's app** (fonepay.com/faqs), so the
     * only artefact they can send is the bank's payment screen with Fonepay's
     * logo on it — `real/banks-08.jpeg`, whose rows these are.
     *
     * That matters beyond tidiness. The invented version used the labels the
     * `FONEPAY` template already matched, so it scored full marks while the real
     * document scored nothing: the template had neither `Reference Code` nor
     * `Qr Merchant Name`, and returned a null payee and a null id on every
     * genuine Fonepay payment in the corpus.
     *
     * `113558024` has the nine-digit shape of the eleven real Everest Bank
     * references in `manifest.json`, and is not any of them.
     */
    brand: "fonepay",
    headline: "Payment For  Himalayan Hostel Pvt Ltd",
    id: "fonepay-qr",
    rows: [
      { label: "Reference Code", value: "113558024" },
      { label: "Date/Time", value: "05 Sep 2026,11:41 AM" },
      { label: "Channel", value: "Online" },
      {
        label: "Payment Attribute",
        value: "2222090020887310/HIM-0042-K/194011457u4T/HIMALAYAN HOSTEL PVT LTD",
      },
      { label: "Service Name", value: "Mobile Convergent" },
      { emphasis: true, label: "Amount (NPR)", value: "12,000.00" },
      { label: "Amount In Words (NPR)", value: "Twelve Thousand Rupees Only" },
      { label: "Initiator", value: "9709155982" },
      { label: "Qr Merchant Name", value: "Himalayan Hostel Pvt Ltd" },
      { label: "Remarks", value: "HIM-0042-K" },
      { label: "Status", value: "SUCCESS" },
    ],
    truth: {
      amount: 12000,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "Himalayan Hostel Pvt Ltd",
      provider: "FONEPAY",
      referenceCode: "HIM-0042-K",
      txnId: "113558024",
    },
  },
  {
    /*
     * The weakest entry here, and labelled as such so nobody mistakes it for
     * evidence.
     *
     * **There is no real ConnectIPS receipt in the corpus.** The field names
     * below are the ones NCHL publishes for the rail (`debtorName`, `acctName`,
     * `remarks`, `referenceId` — doc.connectips.com), which is a far better
     * source than a guess and still not the same thing as a document somebody
     * was actually sent. Treat the layout as unverified until a real one lands.
     *
     * What *was* verifiably wrong is now fixed: the id read
     * `CIPS26090512345678`, a `CIPS`-prefixed eighteen-character form the rail
     * does not issue in any of its documented shapes. NCHL's own examples are a
     * bare numeric `npiTransactionId` (`12346404`) or a timestamp-led twenty
     * character `requestIdentifier` (`20230814110116659QEH`); this is the
     * latter. An invented id shape is exactly how the eSewa fixtures came to
     * assert ten digits when every real eSewa code is seven characters.
     */
    brand: "connectIPS",
    headline: "NPR 16,800.00",
    id: "connectips-transfer",
    rows: [
      { label: "Beneficiary Name", value: "Education Light Hostel" },
      { label: "To Account", value: "01234567890123" },
      { label: "Debited From", value: "98765432109876" },
      { label: "Transaction Id", value: "20260905110116659QEH" },
      { label: "Remarks", value: "EDU-000D-6" },
      { label: "Status", value: "SUCCESS" },
    ],
    truth: {
      amount: 16800,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "Education Light Hostel",
      provider: "CONNECTIPS",
      referenceCode: "EDU-000D-6",
      txnId: "20260905110116659QEH",
    },
  },
  {
    // The bank voucher: two columns, the case the current string parser handles
    // worst and the one bounding boxes are supposed to make trivial.
    brand: "Everest Bank",
    headline: "Transaction Amount  NPR 9,300.00",
    id: "bank-voucher",
    rows: [
      { label: "Qr Merchant Name", value: "Green Valley Hostel" },
      { label: "Initiator", value: "RAMESH THAPA" },
      { label: "Reference Code", value: "EBL0987654321" },
      { label: "Narration", value: "GRN-0007-M" },
      { label: "Date", value: "05-09-2026" },
      { label: "Status", value: "Successful" },
    ],
    truth: {
      amount: 9300,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "Green Valley Hostel",
      provider: "BANK",
      referenceCode: "GRN-0007-M",
      txnId: "EBL0987654321",
    },
  },
  {
    // Devanagari. Vision reads this natively; Tesseract with an English model
    // reads roughly none of it, which is the gap the digit table was papering
    // over.
    brand: "eSewa",
    headline: "रु २,४००.००",
    id: "esewa-devanagari",
    rows: [
      { label: "प्राप्तकर्ता", value: "एजुकेशन लाइट होस्टल" },
      { label: "Transaction Code", value: "8823117766" },
      { label: "मिति", value: "२०८३-०५-२०" },
      { label: "Remarks", value: "EDU-000D-6" },
      { label: "स्थिति", value: "सफल" },
    ],
    truth: {
      amount: 2400,
      direction: "UNKNOWN",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: "एजुकेशन लाइट होस्टल",
      provider: "ESEWA",
      referenceCode: "EDU-000D-6",
      txnId: "8823117766",
    },
  },
  {
    // A failed transaction. The submit path refuses these, so an engine that
    // cannot read the word is an engine that lets one through.
    brand: "eSewa",
    headline: "NPR 5,000.00",
    id: "esewa-failed",
    rows: [
      { label: "Paid to", value: "Education Light Hostel" },
      { label: "Transaction Code", value: "8823119999" },
      { label: "Date", value: "2026-09-05 17:20" },
      { label: "Status", value: "FAILED" },
    ],
    truth: {
      amount: 5000,
      direction: "DEBIT",
      isPaymentReceipt: true,
      outcome: "FAILED",
      payee: "Education Light Hostel",
      provider: "ESEWA",
      referenceCode: null,
      txnId: "8823119999",
    },
  },
  {
    // Money arriving, not leaving. Also refused on submit.
    brand: "eSewa",
    headline: "NPR 3,000.00",
    id: "esewa-received",
    rows: [
      { label: "Received from", value: "BIKASH SHRESTHA" },
      { label: "Transaction Code", value: "8823110001" },
      { label: "Date", value: "2026-09-04 09:11" },
      { label: "Status", value: "COMPLETE" },
    ],
    truth: {
      amount: 3000,
      direction: "CREDIT",
      isPaymentReceipt: true,
      outcome: "SUCCESS",
      payee: null,
      provider: "ESEWA",
      referenceCode: null,
      txnId: "8823110001",
    },
  },
  {
    // Not a receipt at all. The control that says "not a payment record" is a
    // verdict the engine can reach, rather than a thing it says when it fails.
    brand: "Class Notes",
    headline: "Chapter 4 — Thermodynamics",
    id: "not-a-receipt",
    rows: [
      { label: "First law", value: "Energy is conserved" },
      { label: "Second law", value: "Entropy increases" },
      { label: "Tutorial", value: "Friday, room 204" },
    ],
    truth: {
      amount: 0,
      direction: "UNKNOWN",
      isPaymentReceipt: false,
      outcome: "UNKNOWN",
      payee: null,
      provider: "UNKNOWN",
      referenceCode: null,
      txnId: null,
    },
  },
];

/**
 * The palette.
 *
 * **Not a brand palette, on purpose.** These are stand-ins for a receipt card,
 * not reproductions of anyone's app, and copying eSewa's or Khalti's colours
 * into the repository would be both a trademark problem and a lie about what
 * these files are. The recogniser reads contrast and glyph shape; the hue is
 * irrelevant to every measurement the scorer takes.
 */
const LIGHT = { accent: "#0a8a4b", ink: "#111111", muted: "#8a8a8a", paper: "#ffffff" };
const DARK = { accent: "#12a95d", ink: "#f5f5f5", muted: "#9a9a9a", paper: "#101312" };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(layout: Layout, dark: boolean): Buffer {
  const palette = dark ? DARK : LIGHT;
  const width = 760;
  const top = 260;
  const rowHeight = 44;
  const height = top + layout.rows.length * rowHeight + 60;
  const rows = layout.rows
    .map((row, index) => {
      const y = top + index * rowHeight;

      return [
        `<text x="60" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="18"`,
        ` fill="${palette.muted}">${escapeXml(row.label)}</text>`,
        `<text x="${width - 60}" y="${y}" text-anchor="end"`,
        ` font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="bold"`,
        ` fill="${palette.ink}">${escapeXml(row.value)}</text>`,
      ].join("");
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${palette.paper}"/>
    <text x="60" y="78" font-family="Arial, Helvetica, sans-serif" font-size="34"
      font-weight="bold" fill="${palette.accent}">${escapeXml(layout.brand)}</text>
    <text x="60" y="130" font-family="Arial, Helvetica, sans-serif" font-size="22"
      fill="${palette.ink}">${escapeXml(layout.truth.isPaymentReceipt ? "Payment Successful" : "Notes")}</text>
    <text x="60" y="196" font-family="Arial, Helvetica, sans-serif" font-size="40"
      font-weight="bold" fill="${palette.ink}">${escapeXml(layout.headline)}</text>
    ${rows}
  </svg>`;

  return Buffer.from(svg);
}

/**
 * The degradations, each one a state a real receipt actually arrives in.
 *
 * Named for what happened to the file rather than for the transform, because the
 * scorer's output is read by a person deciding whether an engine is good enough:
 * "whatsapp 41% correct" is a sentence about the product.
 */
const VARIANTS = {
  /** Straight off the phone. The ceiling — nothing should score worse than this. */
  clean: (image: Sharp) => image.png(),
  /** Cropped to the card, the way a resident hides their balance. */
  crop: (image: Sharp) =>
    image.resize({ height: 620, position: "top", width: 460 }).jpeg({ quality: 82 }),
  /** Dark mode is applied at render time; this just encodes it. */
  dark: (image: Sharp) => image.png(),
  /** A cheap phone screenshot, then a share-sheet re-compress. */
  lowres: (image: Sharp) => image.resize({ width: 480 }).jpeg({ quality: 50 }),
  /** Photographed off a screen at a slight angle. */
  skewed: (image: Sharp) =>
    image
      .rotate(3, { background: { b: 235, g: 235, r: 235 } })
      .jpeg({ quality: 78 }),
  /** Forwarded through WhatsApp: downscaled to the messenger's limit, re-encoded. */
  whatsapp: (image: Sharp) => image.resize({ width: 702 }).jpeg({ quality: 70 }),
} as const;

type ManifestEntry = GroundTruth & { file: string; variant: string };

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifest: ManifestEntry[] = [];

  for (const layout of LAYOUTS) {
    for (const [variant, transform] of Object.entries(VARIANTS)) {
      const svg = render(layout, variant === "dark");
      const pipeline = transform(sharp(svg, { density: 144 }));
      const extension = variant === "clean" || variant === "dark" ? "png" : "jpg";
      const file = `${layout.id}-${variant}.${extension}`;

      await writeFile(path.join(OUT_DIR, file), await pipeline.toBuffer());

      manifest.push({ ...layout.truth, file, variant });
    }
  }

  /*
   * The hand-written rows survive a regeneration.
   *
   * This script used to write the manifest from `LAYOUTS` alone, which silently
   * deleted every row for a real receipt the moment anybody re-rendered the
   * synthetic half — and those rows are the expensive half of the corpus. A
   * synthetic row can be rebuilt by running this script again; a real row was
   * produced by a person opening the image and reading the amount off it, and
   * the image sitting on disk beside a manifest that no longer mentions it is
   * indistinguishable from a corpus that never had it.
   *
   * Anything this run did not generate is kept exactly as it was found. The
   * synthetic rows are keyed by filename, so re-running with a changed layout
   * still replaces its own rows.
   */
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const generated = new Set(manifest.map((entry) => entry.file));
  let kept: ManifestEntry[] = [];

  try {
    const existing = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as ManifestEntry[];

    kept = existing.filter((entry) => !generated.has(entry.file));
  } catch {
    // No manifest yet, or an unreadable one. Nothing to preserve.
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify([...manifest, ...kept], null, 2)}\n`,
  );

  console.log(
    `Wrote ${manifest.length} synthetic fixtures and a manifest to ${OUT_DIR}`,
  );
  console.log(
    kept.length > 0
      ? `Kept ${kept.length} hand-written manifest rows. They outrank every file above.`
      : "Real receipts belong in the same folder with hand-written manifest rows. They outrank every file above.",
  );
}

void main();
