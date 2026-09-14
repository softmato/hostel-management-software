import { describe, expect, it } from "vitest";

import type { ListRow } from "./existing-residents-check";
import {
  blankSheetRow,
  cleanCell,
  isBlankSheetRow,
  joinedDateText,
  pasteIntoSheet,
  readSheet,
  rentStatusLabel,
  sheetFrom,
} from "./existing-residents-sheet-model";

const context = { currentPeriod: "2083-05", roomTypes: ["Double", "Single"] };

function listRow(patch: Partial<ListRow> = {}): ListRow {
  return {
    depositPaid: 10000,
    email: "ram@example.com",
    fullName: "Ram Thapa",
    id: "row-1",
    joinedDate: null,
    monthlyRent: null,
    oldDues: 0,
    paidTill: "2083-04",
    phone: "9841234567",
    residentId: null,
    roomType: "Double",
    ...patch,
  };
}

describe("the residents sheet", () => {
  it("opens the list with empty lines under it, and saves none of the empty ones", () => {
    const sheet = sheetFrom([listRow()], 5);

    expect(sheet).toHaveLength(6);
    expect(readSheet(sheet)).toEqual({
      errors: [],
      rows: [
        {
          depositPaid: 10000,
          email: "ram@example.com",
          fullName: "Ram Thapa",
          id: "row-1",
          joinedDate: null,
          monthlyRent: null,
          oldDues: 0,
          paidTill: "2083-04",
          phone: "9841234567",
          roomType: "Double",
        },
      ],
    });
  });

  it("shows and reads the joined date as a Nepali date", () => {
    const [row] = sheetFrom([listRow({ joinedDate: "2025-07-31T00:00:00.000Z" })], 0);
    const text = row!.cells.joinedDate;

    expect(text).toMatch(/^2082-04-\d{2}$/);
    expect(readSheet([row!]).rows[0]!.joinedDate).toBe("2025-07-31T00:00:00.000Z");
    expect(joinedDateText(null)).toBe("");
  });

  it("names the cells it cannot read", () => {
    const row = blankSheetRow();

    row.cells = { ...row.cells, fullName: "Sita KC", joinedDate: "last year", monthlyRent: "twelve" };

    expect(readSheet([row]).errors).toEqual([
      { column: "joinedDate", key: row.key, message: "Write the Nepali date like 2082-04-15." },
      { column: "monthlyRent", key: row.key, message: "Write only the amount, like 12000." },
    ]);
  });

  it("pastes copied rows from the cursor, skipping the header and lines already added", () => {
    const sheet = [
      ...sheetFrom([listRow({ id: "added", residentId: "r1" })], 0),
      blankSheetRow(),
    ];
    const pasted = [
      "Full name\tPhone\tRoom type\tMonthly rent (Rs)\tDeposit paid (Rs)\tMonths due",
      "Sita KC\t9801234567\tdouble\t11,000\t\t2",
      "Hari Rai\t9811111111\tSingle\t\t5000\t0",
    ].join("\r\n");

    const next = pasteIntoSheet(sheet, { column: 0, row: 0 }, `${pasted}\r\n`, context);

    expect(next).toHaveLength(3);
    expect(next[0]!.cells.fullName).toBe("Ram Thapa");
    expect(next[1]!.cells).toMatchObject({
      fullName: "Sita KC",
      monthlyRent: "11000",
      paidTill: "2083-03",
      roomType: "Double",
    });
    expect(next[2]!.cells).toMatchObject({ depositPaid: "5000", fullName: "Hari Rai", paidTill: "2083-05" });
    expect(readSheet(next).rows[1]!.monthlyRent).toBe(11000);
  });

  it("pastes a column of values into the column the cursor is on", () => {
    const next = pasteIntoSheet([blankSheetRow()], { column: 1, row: 0 }, "9801234567\n9811111111", context);

    expect(next.map((row) => row.cells.phone)).toEqual(["9801234567", "9811111111"]);
  });

  it("keeps letters out of number boxes, and starts the deposit at 0", () => {
    expect(cleanCell("depositPaid", "Rs 10,000.00")).toBe("10000");
    expect(cleanCell("oldDues", "abc")).toBe("");
    expect(cleanCell("phone", "+977 98-4123 4567")).toBe("+9779841234567");
    expect(cleanCell("joinedDate", "२०८२-०४-१५ BS")).toBe("2082-04-15");
    expect(cleanCell("email", " ram @example.com")).toBe("ram@example.com");

    const row = blankSheetRow();

    expect(row.cells.depositPaid).toBe("0");
    expect(isBlankSheetRow(row)).toBe(true);
    expect(isBlankSheetRow({ ...row, id: "saved-blank" })).toBe(true);
  });

  it("says the rent the way the list asks it", () => {
    expect(rentStatusLabel("2083-05", "2083-05")).toBe("Paid this month");
    expect(rentStatusLabel("2083-05", "2083-03")).toBe("2 months due (Shrawan to Bhadra)");
    expect(rentStatusLabel("2083-05", null)).toBeNull();
  });
});
