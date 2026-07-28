import { describe, expect, it } from "vitest";

import { normalizeResidentId } from "@/modules/users/resident-identity.service";
import {
  residentIdentitySaveSchema,
  residentProfileDataSchema,
} from "@/modules/users/resident-identity.validation";

const validProfile = {
  fullName: "Asha Rai",
  gender: "FEMALE",
  guardianName: "Bimala Rai",
  guardianPhone: "9800000001",
  guardianRelation: "Mother",
  primaryEmail: "Asha@Example.com",
  primaryPhone: "9800000000",
};

describe("normalizeResidentId", () => {
  it("accepts the canonical format", () => {
    expect(normalizeResidentId("HH-4K7M-9XQ2")).toBe("HH-4K7M-9XQ2");
  });

  it("repairs what a warden actually types", () => {
    // Lowercase, missing dashes, stray spaces — all the same person.
    expect(normalizeResidentId("hh4k7m9xq2")).toBe("HH-4K7M-9XQ2");
    expect(normalizeResidentId("  hh 4k7m 9xq2 ")).toBe("HH-4K7M-9XQ2");
    expect(normalizeResidentId("HH_4K7M_9XQ2")).toBe("HH-4K7M-9XQ2");
  });

  it("extracts the id from a scanned share URL", () => {
    expect(normalizeResidentId("https://hostelhub.test/resident-id/HH-4K7M-9XQ2")).toBe(
      "HH-4K7M-9XQ2",
    );
    expect(
      normalizeResidentId("https://hostelhub.test/resident-id/HH-4K7M-9XQ2?utm=qr"),
    ).toBe("HH-4K7M-9XQ2");
  });

  it("rejects anything that is not an id", () => {
    expect(normalizeResidentId("9800000000")).toBeNull();
    expect(normalizeResidentId("HH-4K7M")).toBeNull();
    expect(normalizeResidentId("XX-4K7M-9XQ2")).toBeNull();
    expect(normalizeResidentId("")).toBeNull();
  });
});

describe("residentProfileDataSchema", () => {
  it("normalizes emails and applies sensible defaults", () => {
    const parsed = residentProfileDataSchema.parse(validProfile);

    expect(parsed.primaryEmail).toBe("asha@example.com");
    expect(parsed.bloodGroup).toBe("UNKNOWN");
    expect(parsed.occupation).toBe("STUDENT");
    expect(parsed.dietaryPreference).toBe("NO_PREFERENCE");
    expect(parsed.interests).toEqual([]);
  });

  it("caps the user at two distinct emails", () => {
    expect(() =>
      residentProfileDataSchema.parse({
        ...validProfile,
        backupEmail: "asha@example.com",
      }),
    ).toThrow();

    expect(
      residentProfileDataSchema.parse({
        ...validProfile,
        backupEmail: "asha.backup@example.com",
      }).backupEmail,
    ).toBe("asha.backup@example.com");
  });

  it("treats blank optional fields as absent", () => {
    const parsed = residentProfileDataSchema.parse({
      ...validProfile,
      backupEmail: "",
      dateOfBirth: "",
      medicalNotes: "",
    });

    expect(parsed.backupEmail).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
    expect(parsed.medicalNotes).toBeUndefined();
  });

  it("de-duplicates interests", () => {
    expect(
      residentProfileDataSchema.parse({
        ...validProfile,
        interests: ["football", "football", "music"],
      }).interests,
    ).toEqual(["football", "music"]);
  });

  it("requires a reachable guardian", () => {
    expect(() =>
      residentProfileDataSchema.parse({
        ...validProfile,
        guardianPhone: undefined,
      }),
    ).toThrow();
  });
});

describe("blank form fields", () => {
  /*
   * Regression: an HTML form submits an untouched field as "", not as a missing
   * key. A `<select>` placeholder with value="" used to fail the whole
   * submission with an opaque 422 that named no field.
   */
  const blankable = [
    "alternatePhone",
    "backupEmail",
    "bloodGroup",
    "budgetRange",
    "city",
    "courseOrDesignation",
    "dateOfBirth",
    "dietaryPreference",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "governmentIdNumber",
    "governmentIdType",
    "guardianEmail",
    "institution",
    "medicalNotes",
    "occupation",
    "permanentAddress",
    "province",
    "secondGuardianEmail",
    "secondGuardianName",
    "secondGuardianPhone",
    "secondGuardianRelation",
  ] as const;

  it.each(blankable)("accepts %s as an empty string", (field) => {
    const result = residentProfileDataSchema.safeParse({
      ...validProfile,
      [field]: "",
    });

    expect(result.success).toBe(true);
  });

  it("accepts every optional blank at once", () => {
    const allBlank = Object.fromEntries(blankable.map((field) => [field, ""]));
    const parsed = residentProfileDataSchema.parse({ ...validProfile, ...allBlank });

    // Blanks become absent, and the defaulted selects fall back rather than fail.
    expect(parsed.governmentIdType).toBeUndefined();
    expect(parsed.backupEmail).toBeUndefined();
    expect(parsed.bloodGroup).toBe("UNKNOWN");
    expect(parsed.occupation).toBe("STUDENT");
    expect(parsed.dietaryPreference).toBe("NO_PREFERENCE");
  });

  it("accepts whitespace-only input the same way", () => {
    const parsed = residentProfileDataSchema.parse({
      ...validProfile,
      medicalNotes: "   ",
      secondGuardianName: "  ",
    });

    expect(parsed.medicalNotes).toBeUndefined();
    expect(parsed.secondGuardianName).toBeUndefined();
  });

  it("reports the failing field by its full path, not just the parent", () => {
    /*
     * `flatten()` buckets a nested failure under the top-level key, which reads
     * as "profile" and points the user at nothing. The API sends `issues` with
     * the dotted path so the form can name the actual input.
     */
    const result = residentIdentitySaveSchema.safeParse({
      profile: { ...validProfile, backupEmail: validProfile.primaryEmail },
      sharingEnabled: true,
    });

    expect(result.success).toBe(false);

    const paths = result.error!.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("profile.backupEmail");

    // The leaf segment is what the client maps to a human label.
    expect(paths[0]!.split(".").pop()).toBe("backupEmail");
  });

  it("still rejects a genuinely malformed value", () => {
    expect(
      residentProfileDataSchema.safeParse({ ...validProfile, backupEmail: "nope" })
        .success,
    ).toBe(false);
    expect(
      residentProfileDataSchema.safeParse({ ...validProfile, dateOfBirth: "12/03/2001" })
        .success,
    ).toBe(false);
    expect(
      residentProfileDataSchema.safeParse({ ...validProfile, governmentIdType: "PAN" })
        .success,
    ).toBe(false);
  });
});
