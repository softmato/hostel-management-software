/**
 * Reading a hostel's own QR poster (`qr-payee.ts`).
 *
 * The stakes are asymmetric and every test here follows from that. A *missed*
 * read costs the admin one short form; a *wrong* read is written into the
 * profile as an identifier, and `evidence-payee` then treats receipts naming
 * that account as verified. So the cases worth pinning are the ones where a
 * plausible heuristic would have invented something: a helpline number, a
 * merchant id, the sender half of a layout.
 */
import { describe, expect, it } from "vitest";

import { hasQrPayee, readQrPayee } from "./qr-payee";

describe("readQrPayee", () => {
  it("reads a labelled wallet poster", () => {
    const read = readQrPayee(
      ["Scan & Pay", "Merchant Name: GREEN VIEW HOSTEL", "eSewa ID: 9801234567"].join(
        "\n",
      ),
    );

    expect(read).toEqual({ accountNumber: "9801234567", name: "GREEN VIEW HOSTEL" });
  });

  it("reads a bank standee laid out as a table", () => {
    // The same lesson `evidence-payee` learned from a real Everest Bank receipt:
    // the label and its value sit in adjacent cells, which recognises as a line
    // break rather than the colon a punctuated pattern needs.
    const read = readQrPayee(
      ["NIC ASIA BANK", "A/C Name", "SUNRISE HOSTEL PVT LTD", "A/C No", "0010012345678"].join(
        "\n",
      ),
    );

    expect(read.name).toBe("SUNRISE HOSTEL PVT LTD");
    expect(read.accountNumber).toBe("0010012345678");
  });

  it("reads Devanagari digits", () => {
    expect(readQrPayee("Account Number: ९८०१२३४५६७").accountNumber).toBe("9801234567");
  });

  /**
   * The actual eSewa "receive money" card, which is the commonest poster in
   * Nepal and carries **no labels at all** — wordmark, name, number, footer.
   * The first version of this module was label-anchored and took nothing from
   * it, which is the same fixture mistake the statement parsers made: tuned for
   * documents that mostly do not exist.
   */
  it("reads the unlabelled eSewa receive-money card", () => {
    const read = readQrPayee(
      ["eSewa", "Aadarsh Yadav", "9824870400", "Show this QR code to receive money"].join(
        "\n",
      ),
    );

    expect(read).toEqual({ accountNumber: "9824870400", name: "Aadarsh Yadav" });
  });

  it("reads a real recognition of that card, QR noise and all", () => {
    // Verbatim tesseract output from a dark eSewa-style poster, kept exactly as
    // it came back. The leading junk is the QR block itself being read as text —
    // any structural rule has to survive four lines of garbage above the name,
    // which is what a fixture written by hand would never have contained.
    const read = readQrPayee(
      "Opnd0\nyn =\nrE\nOFz5:\neSewa\nAadarsh Yadav\n9824870400\nShow this QR code to receive money\n",
    );

    expect(read).toEqual({ accountNumber: "9824870400", name: "Aadarsh Yadav" });
  });

  it("does not take the provider wordmark as the account holder", () => {
    // The name sits directly under `eSewa`, so the search upward has to step
    // over the wordmark — otherwise every hostel is registered as "eSewa".
    expect(readQrPayee(["Khalti", "9709155982", "Scan to pay"].join("\n")).name).toBeNull();
  });

  it("takes nothing from a page that is not a payment poster", () => {
    // No wordmark, no `receive money`, no `scan to pay` — so a long number on
    // it is just a long number. This is what keeps the structural read from
    // being "the first big number on the image".
    const read = readQrPayee("Meeting notes\nRoom 4B\n9824870400\nThanks");

    expect(read).toEqual({ accountNumber: null, name: null });
    expect(hasQrPayee(read)).toBe(false);
  });

  it("skips a helpline printed on the poster", () => {
    // The one number on these cards that belongs to somebody else. Storing
    // eSewa's support line as this hostel's account would match it against the
    // next hostel paid from the same wallet.
    const read = readQrPayee(
      ["eSewa", "Helpline", "16600172000", "Show this QR code to receive money"].join(
        "\n",
      ),
    );

    expect(read.accountNumber).toBeNull();
  });

  it("ignores a merchant id", () => {
    // It identifies the QR at the acquirer, not the account, and it never
    // appears on the receipt the resident uploads.
    expect(readQrPayee("Merchant ID: 4411920033\nScan & Pay").accountNumber).toBeNull();
  });

  it("does not call a short number an account", () => {
    expect(readQrPayee("Account No: 4471").accountNumber).toBeNull();
  });

  it("keeps the name when the number shares its line", () => {
    expect(readQrPayee("Account Name  GREEN VIEW HOSTEL  0010012345678").name).toBe(
      "GREEN VIEW HOSTEL",
    );
  });

  it("survives an empty read", () => {
    expect(readQrPayee(null)).toEqual({ accountNumber: null, name: null });
    expect(readQrPayee("")).toEqual({ accountNumber: null, name: null });
  });

  it("counts a name alone as something worth storing", () => {
    // Names match by token in `evidence-payee`, so a name with no number is
    // still a real signal — just a weaker one than an account identifier.
    expect(hasQrPayee(readQrPayee("Merchant Name: GREEN VIEW HOSTEL"))).toBe(true);
  });
});
