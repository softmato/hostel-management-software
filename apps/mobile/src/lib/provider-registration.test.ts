import { describe, expect, it } from "vitest";

import {
  buildProviderPayload,
  EMPTY_PROVIDER_FORM,
  firstIncompleteProviderStep,
  isProviderStepComplete,
  providerCategoryLabel,
  providerStepErrors,
  toggleProviderCategory,
  type ProviderForm,
} from "@/lib/provider-registration";

function form(overrides: Partial<ProviderForm> = {}): ProviderForm {
  return {
    ...EMPTY_PROVIDER_FORM,
    area: "Baneshwor",
    categories: ["PLUMBER"],
    fullName: "Ram Bahadur",
    phone: "9800000000",
    selfie: { fileName: "Your photo", url: "https://cdn.example/selfie.jpg" },
    ...overrides,
  };
}

describe("providerStepErrors", () => {
  it("reports nothing on a step whose fields are filled in", () => {
    expect(providerStepErrors("you", form())).toEqual({});
  });

  it("keys each message to the field it belongs under", () => {
    const errors = providerStepErrors("you", form({ fullName: "R", phone: "123" }));

    expect(Object.keys(errors).sort()).toEqual(["fullName", "phone"]);
  });

  it("uses the schema's own bounds — 7 digits is the phone floor, not 10", () => {
    expect(providerStepErrors("you", form({ phone: "1234567" })).phone).toBeUndefined();
    expect(providerStepErrors("you", form({ phone: "123456" })).phone).toBeDefined();
  });

  it("only reports the step it was asked about", () => {
    // A missing trade is a `trades` problem. Surfacing it on the name step is how
    // a wizard shows a message under a field that has nothing to do with it.
    const blank = form({ categories: [], fullName: "", phone: "" });

    expect(providerStepErrors("trades", blank)).toEqual({
      categories: expect.any(String),
    });
  });

  it("requires the selfie — the one thing this form asks for that the web does not", () => {
    expect(providerStepErrors("selfie", form({ selfie: null }))).toHaveProperty("selfie");
    expect(providerStepErrors("selfie", form())).toEqual({});
  });
});

describe("firstIncompleteProviderStep", () => {
  it("is null once every step validates", () => {
    expect(firstIncompleteProviderStep(form())).toBeNull();
  });

  it("returns the earliest problem, so submit sends you back to the first one", () => {
    expect(
      firstIncompleteProviderStep(form({ area: "", categories: [], fullName: "" })),
    ).toBe("you");
  });

  it("finds a problem several steps back from the review screen", () => {
    expect(firstIncompleteProviderStep(form({ selfie: null }))).toBe("selfie");
  });
});

describe("toggleProviderCategory", () => {
  it("preserves tap order — the first trade becomes the headline one", () => {
    let categories = toggleProviderCategory([], "ELECTRICIAN");
    categories = toggleProviderCategory(categories, "PLUMBER");

    expect(categories).toEqual(["ELECTRICIAN", "PLUMBER"]);
  });

  it("removes on a second tap without disturbing the rest of the order", () => {
    expect(
      toggleProviderCategory(["ELECTRICIAN", "PLUMBER", "CLEANER"], "PLUMBER"),
    ).toEqual(["ELECTRICIAN", "CLEANER"]);
  });
});

describe("providerCategoryLabel", () => {
  it("reads the enum the way the website prints it", () => {
    expect(providerCategoryLabel("INTERNET_TECHNICIAN")).toBe("Internet Technician");
  });
});

describe("buildProviderPayload", () => {
  it("files the selfie as PROFILE_PHOTO, which is what the reviewer's page looks up", () => {
    const payload = buildProviderPayload(form(), "ram@example.com");

    expect(payload.documents[0]).toEqual({
      documentType: "PROFILE_PHOTO",
      fileUrl: "https://cdn.example/selfie.jpg",
    });
  });

  it("puts the portrait first, so an over-long list loses a supporting file instead", () => {
    const documents = Array.from({ length: 9 }, (_, index) => ({
      fileName: `doc-${index}`,
      url: `https://cdn.example/doc-${index}.jpg`,
    }));

    const payload = buildProviderPayload(form({ documents }), null);

    expect(payload.documents).toHaveLength(8);
    expect(payload.documents[0].documentType).toBe("PROFILE_PHOTO");
  });

  it("drops empty optionals rather than sending them as blank strings", () => {
    const payload = buildProviderPayload(form({ availability: "  " }), null);

    expect(payload.availability).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.email).toBeUndefined();
  });

  it("takes the email from the session, not from anything typed", () => {
    expect(buildProviderPayload(form(), "ram@example.com").email).toBe(
      "ram@example.com",
    );
  });

  it("falls back to Kathmandu, matching the schema's default", () => {
    expect(buildProviderPayload(form({ city: "   " }), null).city).toBe("Kathmandu");
  });

  it("trims what it sends", () => {
    const payload = buildProviderPayload(
      form({ area: "  Baneshwor  ", fullName: "  Ram  " }),
      null,
    );

    expect(payload.area).toBe("Baneshwor");
    expect(payload.fullName).toBe("Ram");
  });
});

describe("isProviderStepComplete", () => {
  it("drives the tracker's ticks off the same rules the Continue button uses", () => {
    expect(isProviderStepComplete("trades", form({ categories: [] }))).toBe(false);
    expect(isProviderStepComplete("trades", form())).toBe(true);
  });
});
