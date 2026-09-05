import { describe, expect, it } from "vitest";

import {
  describeGuardianOnRecord,
  describeInvitation,
  describeSharing,
  type GuardianLink,
  type GuardianOnRecord,
  type GuardianPermissions,
  grantedKeys,
  grantedLabels,
  invalidInviteReason,
  invitableGuardians,
  inviteDraftFrom,
  NO_GUARDIAN_PERMISSIONS,
} from "@/lib/guardian-access";

function permissions(...on: (keyof GuardianPermissions)[]): GuardianPermissions {
  return on.reduce<GuardianPermissions>(
    (accumulator, key) => ({ ...accumulator, [key]: true }),
    { ...NO_GUARDIAN_PERMISSIONS },
  );
}

const NOW = new Date("2026-09-04T06:00:00.000Z");

describe("what a guardian can see", () => {
  it("says nothing is shared when nothing is", () => {
    expect(describeSharing(NO_GUARDIAN_PERMISSIONS)).toBe("Nothing shared yet");
    expect(grantedLabels(NO_GUARDIAN_PERMISSIONS)).toEqual([]);
  });

  it("names the single grant rather than counting it", () => {
    expect(describeSharing(permissions("canViewFood"))).toBe("This week's food menu");
  });

  it("names the first grant and counts the rest", () => {
    expect(describeSharing(permissions("canViewPayments", "canViewFood"))).toBe(
      "Fee status (paid / unpaid / due) and 1 more",
    );
  });

  it("orders grants by the form's order, not the object's key order", () => {
    // `canViewComplaintStatus` sorts first alphabetically and is deliberately
    // last on screen — money is what a parent opens this for.
    expect(grantedKeys(permissions("canViewComplaintStatus", "canViewPayments"))).toEqual(
      ["canViewPayments", "canViewComplaintStatus"],
    );
  });

  it("uses the server's wording, not the web page's shorter version", () => {
    // The email a guardian receives is built from these exact strings.
    expect(grantedLabels(permissions("canViewComplaintStatus"))).toEqual([
      "Complaint status (titles only, never the details)",
    ]);
  });
});

describe("an invitation that has not been accepted", () => {
  it("says nothing once the guardian is in", () => {
    expect(describeInvitation({ invitationPending: false }, NOW)).toBeNull();
  });

  it("counts the days left", () => {
    expect(
      describeInvitation(
        { invitationExpiresAt: "2026-09-07T06:00:00.000Z", invitationPending: true },
        NOW,
      ),
    ).toBe("Invitation expires in 3 days");
  });

  it("says tomorrow rather than 1 day", () => {
    expect(
      describeInvitation(
        { invitationExpiresAt: "2026-09-05T06:00:00.000Z", invitationPending: true },
        NOW,
      ),
    ).toBe("Invitation expires tomorrow");
  });

  it("tells the resident to re-invite once it has lapsed", () => {
    expect(
      describeInvitation(
        { invitationExpiresAt: "2026-09-03T06:00:00.000Z", invitationPending: true },
        NOW,
      ),
    ).toBe("Invitation expired — invite them again");
  });

  it("does not guess expired when the payload carries no expiry", () => {
    // The field is optional on `serializeGuardianLink`. Reporting "expired"
    // would tell a resident to re-send an invitation that still works.
    expect(describeInvitation({ invitationPending: true }, NOW)).toBe(
      "Invitation sent — not accepted yet",
    );
  });

  it("does not guess expired on an unparseable date either", () => {
    expect(
      describeInvitation(
        { invitationExpiresAt: "not a date", invitationPending: true },
        NOW,
      ),
    ).toBe("Invitation sent — not accepted yet");
  });
});

describe("the invite form, against guardianInviteSchema", () => {
  const valid = {
    email: "aama@example.com",
    firstName: "Sita",
    lastName: "Sharma",
    phone: "9800000000",
    relation: "Mother",
  };

  it("accepts a filled-in form", () => {
    expect(invalidInviteReason(valid)).toBeNull();
  });

  it("reports one problem at a time, in field order", () => {
    expect(invalidInviteReason({ ...valid, email: "nope", firstName: "" })).toBe(
      "Their first name is needed.",
    );
  });

  it("refuses a relation of one character (the schema wants 2)", () => {
    expect(invalidInviteReason({ ...valid, relation: "M" })).toBe(
      "Say how they are related — Mother, Father, Uncle.",
    );
  });

  it("refuses a phone shorter than the schema's 6", () => {
    expect(invalidInviteReason({ ...valid, phone: "98000" })).toBe(
      "Check the phone number — it is how they are identified when they sign in.",
    );
  });

  it("trims before measuring, the way the schema does", () => {
    expect(invalidInviteReason({ ...valid, relation: "  M  " })).not.toBeNull();
    expect(invalidInviteReason({ ...valid, firstName: "  Sita  " })).toBeNull();
  });

  it("accepts an address a stricter regex would reject", () => {
    // The server runs `z.string().email()`. Being stricter here would refuse a
    // working address, which is worse than one failed round trip.
    expect(invalidInviteReason({ ...valid, email: "a+b@sub.example.co.uk" })).toBeNull();
  });
});

describe("inviting somebody the hostel already knows about", () => {
  const aama: GuardianOnRecord = {
    email: "Aama@Example.com",
    firstName: " Sita ",
    id: "g1",
    isPrimary: true,
    lastName: "Sharma",
    phone: " 9800000000 ",
    relation: "Mother",
  };

  const uncle: GuardianOnRecord = {
    email: "kaka@example.com",
    firstName: "Ram",
    id: "g2",
    isPrimary: false,
    lastName: "Sharma",
    phone: "+977 9811111111",
    relation: "Uncle",
  };

  function link(over: Partial<Pick<GuardianLink, "email" | "guardianId" | "phone">>) {
    return { email: "", guardianId: "", phone: "", ...over };
  }

  it("fills the invite form from the record, trimmed", () => {
    expect(inviteDraftFrom(aama)).toEqual({
      email: "Aama@Example.com",
      firstName: "Sita",
      lastName: "Sharma",
      phone: "9800000000",
      relation: "Mother",
    });
  });

  it("offers everybody on record when nobody is linked yet", () => {
    expect(invitableGuardians([uncle, aama], [])).toEqual([aama, uncle]);
  });

  it("puts the primary guardian first — they are who the office calls", () => {
    expect(invitableGuardians([uncle, aama], []).map((one) => one.id)).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("drops the guardian the link came from", () => {
    expect(invitableGuardians([aama, uncle], [link({ guardianId: "g1" })])).toEqual([
      uncle,
    ]);
  });

  it("drops a match on email whatever its case, and on phone whatever its format", () => {
    // A resident can invite an address the office never wrote down, and the
    // office can add a row for somebody already linked — the id match alone
    // would miss both, and re-offering them replaces a working invitation.
    expect(
      invitableGuardians([aama, uncle], [link({ email: "aama@example.com" })]),
    ).toEqual([uncle]);
    expect(invitableGuardians([aama, uncle], [link({ phone: "9811111111" })])).toEqual([
      aama,
    ]);
  });

  it("does not treat two blank emails as the same person", () => {
    // The failure worth avoiding is hiding a parent who has no access at all.
    const noEmail = { ...uncle, email: "", phone: "" };

    expect(invitableGuardians([noEmail], [link({ email: "", phone: "" })])).toEqual([
      noEmail,
    ]);
  });

  it("names a person the way the chooser does", () => {
    expect(describeGuardianOnRecord(uncle)).toBe("Ram Sharma · Uncle");
    expect(describeGuardianOnRecord({ ...uncle, relation: "" })).toBe("Ram Sharma");
  });
});
