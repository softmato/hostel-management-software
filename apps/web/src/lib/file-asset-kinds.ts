/**
 * What a file is *for*, as opposed to what format it is in.
 *
 * `UploadKind` ("image", "document", …) answers "which bytes are acceptable".
 * This answers "which part of the product is this evidence for", which is what
 * the authorization layer needs: a payment screenshot must be readable only
 * inside its own hostel, so a financial asset without a `hostelId` is a bug we
 * refuse to create rather than one we discover later.
 */
export const FILE_ASSET_KINDS = [
  "GENERIC",
  "PAYMENT_PROOF",
  "PAYMENT_QR",
  "STATEMENT",
] as const;

export type FileAssetKind = (typeof FILE_ASSET_KINDS)[number];

/**
 * Kinds that carry money evidence. Every one of these must be tenant-scoped at
 * presign time — see docs/FINANCE_IMPLEMENTATION_PLAN.md item 0.1.
 */
const FINANCIAL_KINDS = new Set<FileAssetKind>([
  "PAYMENT_PROOF",
  "PAYMENT_QR",
  "STATEMENT",
]);

export function isFileAssetKind(value: unknown): value is FileAssetKind {
  return typeof value === "string" && FILE_ASSET_KINDS.includes(value as FileAssetKind);
}

export function isFinancialAssetKind(value: unknown): boolean {
  return isFileAssetKind(value) && FINANCIAL_KINDS.has(value);
}
