import { describe, expect, it } from "vitest";

import type { ResidentPrefill } from "@/lib/admin-manage-api";
import {
  backgroundFacts,
  careFacts,
  collectableBills,
  firstMonthNote,
  identityFacts,
  intakePeople,
  rentBasisNote,
} from "@/lib/resident-intake";

/**
 * The confirm step reads a scanned profile back to a warden who is checking it
 * against the person in front of them. What is shown, what is dropped and what
 * each row is called are the whole feature, so they are tested here rather than
 * squinted at on a device.
 */

function prefill(overrides: Partial<ResidentPrefill> = {}): ResidentPrefill {
  return {
    details: {
      age: 20,
      alternatePhone: null,
      backupEmail: null,
      bloodGroup: "B+",
      budgetRange: null,
      city: "Lalitpur",
      courseOrDesignation: "BSc CSIT",
      dateOfBirth: "2006-03-14",
      dietaryPreference: "VEGETARIAN",
      gender: "FEMALE",
      governmentIdNumber: "12-34-56",
      governmentIdType: "CITIZENSHIP",
      institution: "Patan College",
      interests: ["Football", "Guitar"],
      medicalNotes: null,
      permanentAddress: "Jhamsikhel",
      province: "Bagmati",
      ...overrides.details,
    },
    emergencyContact: {
      isPrimary: true,
      name: "Ram Rai",
      phone: "9800000001",
      relation: "FATHER",
      ...overrides.emergencyContact,
    },
    guardians: overrides.guardians ?? [
      {
        firstName: "Ram",
        isPrimary: true,
        lastName: "Rai",
        phone: "9800000001",
        relation: "FATHER",
      },
      {
        firstName: "Sita",
        isPrimary: false,
        lastName: "Rai",
        phone: "9800000002",
        relation: "MOTHER",
      },
    ],
    resident: {
      email: "asha@example.com",
      firstName: "Asha",
      lastName: "Rai",
      phone: "9800000000",
      residentType: "STUDENT",
      ...overrides.resident,
    },
  };
}

describe("intake confirm rows", () => {
  it("labels the ID row by the document they actually carry", () => {
    const rows = identityFacts(prefill(), "AD");

    // Not "Government ID" — the card names itself, and a warden is looking at it.
    expect(rows).toContainEqual({ label: "Citizenship", value: "12-34-56" });
  });

  it("drops blanks instead of printing a column of dashes", () => {
    const rows = identityFacts(
      prefill({
        details: { ...prefill().details, age: null, governmentIdNumber: null },
      }),
      "AD",
    );

    const labels = rows.map((row) => row.label);

    expect(labels).not.toContain("Age");
    expect(labels).not.toContain("Citizenship");
    expect(labels).toContain("Full name");
  });

  it("joins the address the way it is written on an envelope", () => {
    const rows = backgroundFacts(prefill());

    expect(rows).toContainEqual({
      label: "Home address",
      value: "Jhamsikhel, Lalitpur, Bagmati",
    });
    expect(rows).toContainEqual({ label: "Interests", value: "Football, Guitar" });
  });

  it("says a blood group is missing rather than omitting the row", () => {
    // "We were not told" and "we forgot to look" have to be distinguishable at
    // three in the morning, so this row is always drawn.
    const rows = careFacts(
      prefill({ details: { ...prefill().details, bloodGroup: "UNKNOWN" } }),
    );

    expect(rows).toContainEqual({ label: "Blood group", value: "Not stated" });
  });

  it("names guardians by relation, primary first", () => {
    const people = intakePeople(prefill());

    expect(people.map((person) => person.label)).toEqual(["Father", "Mother"]);
    expect(people[0]).toMatchObject({ name: "Ram Rai", phone: "9800000001" });
  });

  it("does not list the same person twice as guardian and emergency contact", () => {
    // The server falls back to the guardian's own details when no separate
    // emergency contact was named. Printing both reads as two numbers to call,
    // and a warden ringing the second one has wasted the minute that counted.
    const people = intakePeople(prefill());

    expect(people).toHaveLength(2);
    expect(people.filter((person) => person.phone === "9800000001")).toHaveLength(1);
  });

  it("keeps a genuinely separate emergency contact", () => {
    const people = intakePeople(
      prefill({
        emergencyContact: {
          isPrimary: true,
          name: "Hari Thapa",
          phone: "9811111111",
          relation: "UNCLE",
        },
      }),
    );

    expect(people).toHaveLength(3);
    expect(people[2]).toMatchObject({ label: "Emergency · Uncle", name: "Hari Thapa" });
  });

  it("never claims a rate card exists when nothing prices the room", () => {
    expect(rentBasisNote("SCHEDULE")).toMatch(/rate card/i);
    expect(rentBasisNote("ROOM_CONFIGURATION")).toMatch(/no rate card/i);
    expect(rentBasisNote("UNPRICED")).toMatch(/nothing prices/i);
  });

  it("shows the fraction behind a part month, and never 31 of 31", () => {
    // The numerator and denominator are the resident's answer to "why is this
    // not the rent you quoted me", and they match the invoice line's own
    // `prorationBasis` word for word.
    expect(
      firstMonthNote({ billableDays: 12, daysInMonth: 31, prorated: true }),
    ).toMatch(/12 of 31 days/);

    const full = firstMonthNote({
      billableDays: 31,
      daysInMonth: 31,
      prorated: false,
    });

    expect(full).not.toMatch(/31 of 31/);
    expect(full).toMatch(/full month/i);
  });
});

/**
 * What the warden can collect before the resident walks away.
 *
 * The rule worth protecting: two invoices are two payments with two codes, and
 * the joining row's figure includes the deposit — so it must not be labelled as
 * though it were the admission fee alone.
 */
describe("collectableBills", () => {
  const monthLabel = (period: string | null) =>
    period === "2083-05" ? "Bhadra" : String(period);

  const raised = {
    admission: {
      amount: 12000,
      invoiceId: "a1",
      raised: true,
      referenceCode: "EDU-000D-6",
    },
    firstMonth: {
      amount: 16800,
      invoiceId: "i1",
      period: "2083-05",
      raised: true,
      referenceCode: "EDU-000E-7",
    },
    quote: { admissionFee: 2000, depositAmount: 10000 },
  };

  it("keeps the two invoices apart, each with its own code", () => {
    expect(collectableBills(raised, monthLabel)).toEqual([
      {
        amount: 12000,
        label: "Admission fee + Security deposit",
        referenceCode: "EDU-000D-6",
      },
      {
        amount: 16800,
        label: "Monthly rent — Bhadra",
        referenceCode: "EDU-000E-7",
      },
    ]);
  });

  /*
   * `admission.amount` is the fee after any discount *plus* the deposit — see
   * `raiseAdmissionInvoice`. Calling that row "Admission fee" would understate
   * what the fee is by the size of the deposit, which is usually the larger of
   * the two.
   */
  it("names only the charges the hostel actually takes", () => {
    expect(
      collectableBills(
        { ...raised, quote: { admissionFee: 2000, depositAmount: 0 } },
        monthLabel,
      )[0].label,
    ).toBe("Admission fee");

    expect(
      collectableBills(
        { ...raised, quote: { admissionFee: 0, depositAmount: 10000 } },
        monthLabel,
      )[0].label,
    ).toBe("Security deposit");
  });

  it("drops an invoice that was not raised", () => {
    const bills = collectableBills(
      { ...raised, firstMonth: { period: "2083-05", raised: false, reason: "NO_RATE_CARD" } },
      monthLabel,
    );

    expect(bills).toHaveLength(1);
    expect(bills[0].referenceCode).toBe("EDU-000D-6");
  });

  /*
   * A code the phone cannot show is not a way to pay, and an empty strip under
   * a live figure is a screen telling a warden to read out nothing. An older
   * API that omits these fields entirely must produce no rows rather than
   * throw — this runs against whatever `EXPO_PUBLIC_API_URL` points at.
   */
  it("shows nothing for a bill with no code, and survives an older response", () => {
    expect(
      collectableBills(
        { ...raised, admission: { amount: 12000, raised: true }, firstMonth: null },
        monthLabel,
      ),
    ).toEqual([]);

    expect(collectableBills({}, monthLabel)).toEqual([]);
  });
});
