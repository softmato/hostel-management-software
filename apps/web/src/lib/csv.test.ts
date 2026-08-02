import { describe, expect, it } from "vitest";

import { csvCell, csvFilename, toCsv } from "@/lib/csv";

describe("csv serialisation", () => {
  it("quotes values that would otherwise break the row", () => {
    expect(csvCell("Sunrise, Lalitpur")).toBe('"Sunrise, Lalitpur"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("leaves ordinary values untouched", () => {
    expect(csvCell("Sunrise Hostel")).toBe("Sunrise Hostel");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  // Hostel names and complaint titles are typed by users, and Excel executes a
  // cell that starts with =, +, - or @ the moment the file is opened.
  it("neutralises spreadsheet formula injection", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 1234")).toBe("'+44 1234");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
  });

  it("does not mangle negative numbers we produced ourselves", () => {
    // The trigger list includes "-", but a real number is not user input.
    expect(csvCell(-250)).toBe("-250");
  });

  it("builds a CRLF document with a header row", () => {
    const csv = toCsv(
      [
        { key: "status", label: "Status" },
        { key: "count", label: "Hostels" },
      ],
      [
        { count: 3, status: "APPROVED" },
        { count: 1, status: "PENDING_APPROVAL" },
      ],
    );

    expect(csv).toBe("Status,Hostels\r\nAPPROVED,3\r\nPENDING_APPROVAL,1\r\n");
  });

  it("emits a header-only document when there is nothing to export", () => {
    expect(toCsv([{ key: "status", label: "Status" }], [])).toBe("Status\r\n");
  });

  it("stamps the filename with the export date", () => {
    expect(csvFilename("hostels-by-status", new Date("2026-08-01T10:00:00Z"))).toBe(
      "hostels-by-status-2026-08-01.csv",
    );
  });
});
