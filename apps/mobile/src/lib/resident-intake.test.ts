import { describe, expect, it } from "vitest";

import type { ResidentPrefill } from "@/lib/admin-manage-api";
import {
  backgroundFacts,
  careFacts,
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
    const rows = identityFacts(prefill());

    // Not "Government ID" — the card names itself, and a warden is looking at it.
    expect(rows).toContainEqual({ label: "Citizenship", value: "12-34-56" });
  });

  it("drops blanks instead of printing a column of dashes", () => {
    const rows = identityFacts(
      prefill({
        details: { ...prefill().details, age: null, governmentIdNumber: null },
      }),
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
});
