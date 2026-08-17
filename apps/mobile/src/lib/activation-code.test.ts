import { describe, expect, it } from "vitest";

import {
  activationCodeError,
  normalizeActivationCode,
  parseScannedCode,
} from "@/lib/activation-code";

describe("normalizeActivationCode", () => {
  it("upper-cases and strips whitespace", () => {
    expect(normalizeActivationCode("  ab12 cd34 ")).toBe("AB12CD34");
  });
});

describe("parseScannedCode", () => {
  it("pulls the code out of the activation URL the QR actually encodes", () => {
    expect(
      parseScannedCode("https://hostelhub.com.np/resident-activation?code=AB12CD34"),
    ).toBe("AB12CD34");
  });

  it("works against a dev LAN host, not just the production domain", () => {
    expect(
      parseScannedCode("http://192.168.1.14:3000/resident-activation?code=AB12CD34"),
    ).toBe("AB12CD34");
  });

  it("finds the code when it is not the first query parameter", () => {
    expect(
      parseScannedCode("https://example.com/resident-activation?ref=email&code=AB12CD34"),
    ).toBe("AB12CD34");
  });

  it("stops at the next parameter and at a fragment", () => {
    expect(parseScannedCode("https://x.test/a?code=AB12CD34&next=/home")).toBe(
      "AB12CD34",
    );
    expect(parseScannedCode("https://x.test/a?code=AB12CD34#top")).toBe("AB12CD34");
  });

  it("decodes a percent-encoded code", () => {
    expect(parseScannedCode("https://x.test/a?code=AB12%43D34")).toBe("AB12CD34");
  });

  it("accepts a bare code, since some QRs carry only that", () => {
    expect(parseScannedCode("AB12CD34")).toBe("AB12CD34");
    expect(parseScannedCode("  ab12cd34  ")).toBe("AB12CD34");
  });

  it("rejects a QR for something else rather than posting it as an attempt", () => {
    expect(parseScannedCode("WIFI:S:HostelWiFi;T:WPA;P:letmein;;")).toBeNull();
    expect(parseScannedCode("https://example.com/some/other/page")).toBeNull();
    expect(parseScannedCode("BEGIN:VCARD")).toBeNull();
  });

  it("rejects an empty or too-short payload", () => {
    expect(parseScannedCode("")).toBeNull();
    expect(parseScannedCode("   ")).toBeNull();
    expect(parseScannedCode("AB12")).toBeNull();
    expect(parseScannedCode("https://x.test/a?code=AB12")).toBeNull();
  });

  it("rejects a code longer than the schema accepts", () => {
    expect(parseScannedCode("A".repeat(33))).toBeNull();
    expect(parseScannedCode("A".repeat(32))).toBe("A".repeat(32));
  });
});

describe("activationCodeError", () => {
  it("passes a well-formed code", () => {
    expect(activationCodeError("AB12CD34")).toBeNull();
    expect(activationCodeError("ab12cd34")).toBeNull();
  });

  it("asks for a code rather than complaining about length when empty", () => {
    expect(activationCodeError("")).toMatch(/Enter the code/);
    expect(activationCodeError("   ")).toMatch(/Enter the code/);
  });

  it("names the minimum and the maximum", () => {
    expect(activationCodeError("AB12")).toMatch(/at least 6/);
    expect(activationCodeError("A".repeat(33))).toMatch(/at most 32/);
  });
});
