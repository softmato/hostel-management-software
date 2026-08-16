import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAILBOXES,
  EMAIL_CATEGORIES,
  fallbackEmailIdentity,
  fromHeaderFor,
  replyToFor,
  resolveEmailIdentity,
  setEmailIdentityResolver,
  type EmailIdentity,
} from "@hostel/shared/email/identity";

const getSiteConfigSection = vi.hoisted(() => vi.fn());

vi.mock("@/modules/platform-config/site-config.service", () => ({
  getSiteConfigSection,
}));

const BASE: EmailIdentity = {
  domain: "softmato.com",
  mailboxes: { ...DEFAULT_MAILBOXES },
  replyTo: "support@softmato.com",
  senderName: "HostelHub",
};

describe("fromHeaderFor", () => {
  it("sends each category from its own mailbox", () => {
    expect(fromHeaderFor("info", BASE)).toBe("HostelHub <info@softmato.com>");
    expect(fromHeaderFor("alert", BASE)).toBe("HostelHub Alerts <alert@softmato.com>");
    expect(fromHeaderFor("billing", BASE)).toBe(
      "HostelHub Billing <billing@softmato.com>",
    );
    expect(fromHeaderFor("security", BASE)).toBe(
      "HostelHub Security <security@softmato.com>",
    );
    expect(fromHeaderFor("support", BASE)).toBe(
      "HostelHub Support <support@softmato.com>",
    );
    expect(fromHeaderFor("noreply", BASE)).toBe("HostelHub <noreply@softmato.com>");
  });

  it("produces a usable header for every category", () => {
    for (const category of EMAIL_CATEGORIES) {
      expect(fromHeaderFor(category, BASE)).toMatch(/^[^<>]+ <[^@\s]+@softmato\.com>$/);
    }
  });

  it("follows the admin-configured sender name", () => {
    expect(fromHeaderFor("info", { ...BASE, senderName: "Sajilo Hostel" })).toBe(
      "Sajilo Hostel <info@softmato.com>",
    );
  });

  it("follows admin-configured mailboxes", () => {
    const renamed = {
      ...BASE,
      mailboxes: { ...BASE.mailboxes, alert: "urgent", billing: "accounts" },
    };

    expect(fromHeaderFor("alert", renamed)).toBe("HostelHub Alerts <urgent@softmato.com>");
    expect(fromHeaderFor("billing", renamed)).toBe(
      "HostelHub Billing <accounts@softmato.com>",
    );
  });

  it("falls back to the shipped mailbox when one is blank", () => {
    const blank = { ...BASE, mailboxes: { ...BASE.mailboxes, billing: "" } };

    expect(fromHeaderFor("billing", blank)).toBe(
      "HostelHub Billing <billing@softmato.com>",
    );
  });

  it("tolerates a domain typed with a leading @", () => {
    expect(fromHeaderFor("info", { ...BASE, domain: "@softmato.com" })).toBe(
      "HostelHub <info@softmato.com>",
    );
  });

  it("returns null with no domain, so the sender can no-op instead of throwing", () => {
    expect(fromHeaderFor("info", { ...BASE, domain: "" })).toBeNull();
  });

  /**
   * The sender name is admin-editable free text and lands verbatim in a mail
   * header. A quote or an angle bracket there would let whoever can edit site
   * settings rewrite the envelope — spoofing the address the mail claims to be
   * from, in mail the platform itself sends.
   */
  it("strips header-breaking characters out of the sender name", () => {
    const injected = {
      ...BASE,
      senderName: 'Evil" <attacker@evil.test>, x',
    };

    expect(fromHeaderFor("info", injected)).toBe(
      "Evil attacker@evil.test x <info@softmato.com>",
    );
  });

  it("falls back to the product name when the sender name is only punctuation", () => {
    expect(fromHeaderFor("info", { ...BASE, senderName: '<<>>",;' })).toBe(
      "HostelHub <info@softmato.com>",
    );
  });
});

describe("replyToFor", () => {
  const derived = { ...BASE, replyTo: "" };

  /**
   * The regression this whole function exists for. Reply-to used to fall back
   * to the site's public support address, whose shipped default is
   * `support@hostelhub.com.np` — a domain nobody owns. Sending looked perfect
   * and every reply bounced, which is invisible until a real user tries to
   * answer one.
   */
  it("derives a reply address on the sending domain, never off it", () => {
    for (const category of EMAIL_CATEGORIES) {
      const replyTo = replyToFor(category, derived);

      if (category === "noreply") {
        continue;
      }

      expect(replyTo).toBe("info@softmato.com");
    }
  });

  it("follows the sending domain when it changes", () => {
    expect(replyToFor("billing", { ...derived, domain: "sajilo.test" })).toBe(
      "info@sajilo.test",
    );
  });

  it("follows a renamed general mailbox", () => {
    expect(
      replyToFor("alert", {
        ...derived,
        mailboxes: { ...derived.mailboxes, info: "hello" },
      }),
    ).toBe("hello@softmato.com");
  });

  it("gives no-reply mail no reply address at all", () => {
    expect(replyToFor("noreply", derived)).toBe("");
    expect(replyToFor("noreply", { ...BASE, replyTo: "someone@example.test" })).toBe("");
  });

  it("uses an explicitly configured address over the derived one", () => {
    expect(replyToFor("support", { ...BASE, replyTo: "hello@sajilo.test" })).toBe(
      "hello@sajilo.test",
    );
  });

  it("returns nothing rather than a bare @domain when no domain is set", () => {
    expect(replyToFor("info", { ...derived, domain: "" })).toBe("");
  });
});

describe("fallbackEmailIdentity", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("reads the sending domain from the environment", () => {
    process.env.EMAIL_DOMAIN = "example.test";

    expect(fallbackEmailIdentity().domain).toBe("example.test");
  });

  it("defaults to the shared Softmato domain", () => {
    delete process.env.EMAIL_DOMAIN;

    expect(fallbackEmailIdentity().domain).toBe("softmato.com");
  });
});

describe("resolveEmailIdentity", () => {
  afterEach(() => {
    setEmailIdentityResolver(null);
  });

  it("uses the registered resolver", async () => {
    setEmailIdentityResolver(() => ({ ...BASE, senderName: "Configured" }));

    await expect(resolveEmailIdentity()).resolves.toMatchObject({
      senderName: "Configured",
    });
  });

  /**
   * An SOS must not be blocked by a settings read. A resolver that throws is
   * the database being unreachable, which is exactly when the alert matters.
   */
  it("falls back rather than throwing when the resolver fails", async () => {
    setEmailIdentityResolver(() => {
      throw new Error("mongo down");
    });

    await expect(resolveEmailIdentity()).resolves.toMatchObject({
      domain: expect.any(String),
    });
  });
});

describe("loadEmailIdentity", () => {
  const snapshot = { ...process.env };

  const EMAIL_SECTION = {
    alertMailbox: "",
    billingMailbox: "",
    domain: "",
    infoMailbox: "",
    noreplyMailbox: "",
    replyTo: "",
    securityMailbox: "",
    senderName: "",
    supportMailbox: "",
  };

  const IDENTITY_SECTION = {
    address: "",
    siteName: "Sajilo Hostel",
    supportEmail: "help@sajilo.test",
    supportPhone: "",
    tagline: "",
  };

  beforeEach(async () => {
    vi.resetModules();
    getSiteConfigSection.mockReset();
    getSiteConfigSection.mockImplementation((section: string) =>
      Promise.resolve(section === "email" ? EMAIL_SECTION : IDENTITY_SECTION),
    );
    process.env.EMAIL_DOMAIN = "softmato.com";

    const { resetEmailIdentityCache } = await import("./email-identity");

    resetEmailIdentityCache();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("brands email with the site name when no sender name is set", async () => {
    const { loadEmailIdentity } = await import("./email-identity");

    await expect(loadEmailIdentity()).resolves.toMatchObject({
      senderName: "Sajilo Hostel",
    });
  });

  /**
   * `identity.supportEmail` is a contact detail for the public footer, not a
   * routing address, and it defaults to a domain nobody owns. Promoting it into
   * the envelope is what made every reply bounce.
   */
  it("does not adopt the public support email as the reply address", async () => {
    const { loadEmailIdentity } = await import("./email-identity");
    const { replyToFor } = await import("@hostel/shared/email/identity");

    const resolved = await loadEmailIdentity();

    expect(resolved.replyTo).toBe("");
    expect(replyToFor("info", resolved)).toBe("info@softmato.com");
  });

  it("keeps an explicitly configured sender name and reply-to", async () => {
    getSiteConfigSection.mockImplementation((section: string) =>
      Promise.resolve(
        section === "email"
          ? { ...EMAIL_SECTION, replyTo: "hello@sajilo.test", senderName: "Sajilo Mail" }
          : IDENTITY_SECTION,
      ),
    );

    const { loadEmailIdentity } = await import("./email-identity");

    await expect(loadEmailIdentity()).resolves.toMatchObject({
      replyTo: "hello@sajilo.test",
      senderName: "Sajilo Mail",
    });
  });

  /**
   * The domain is the one field the environment outranks the admin UI on: it
   * has to match what Resend verified for this deployment, and a settings form
   * is where that gets mistyped.
   */
  it("keeps the deployment's sending domain even when config names another", async () => {
    getSiteConfigSection.mockImplementation((section: string) =>
      Promise.resolve(
        section === "email" ? { ...EMAIL_SECTION, domain: "typo.test" } : IDENTITY_SECTION,
      ),
    );

    const { loadEmailIdentity } = await import("./email-identity");

    await expect(loadEmailIdentity()).resolves.toMatchObject({
      domain: "softmato.com",
    });
  });

  it("uses the configured domain when the deployment sets none", async () => {
    delete process.env.EMAIL_DOMAIN;
    getSiteConfigSection.mockImplementation((section: string) =>
      Promise.resolve(
        section === "email" ? { ...EMAIL_SECTION, domain: "own.test" } : IDENTITY_SECTION,
      ),
    );

    const { loadEmailIdentity } = await import("./email-identity");

    await expect(loadEmailIdentity()).resolves.toMatchObject({ domain: "own.test" });
  });

  it("reads settings once per burst rather than once per email", async () => {
    const { loadEmailIdentity } = await import("./email-identity");

    await Promise.all([loadEmailIdentity(), loadEmailIdentity(), loadEmailIdentity()]);
    await loadEmailIdentity();

    // Two calls — the email and identity sections — for the first read only.
    expect(getSiteConfigSection).toHaveBeenCalledTimes(2);
  });

  it("still returns a usable sender when the settings read fails", async () => {
    getSiteConfigSection.mockRejectedValue(new Error("mongo down"));

    const { loadEmailIdentity } = await import("./email-identity");

    await expect(loadEmailIdentity()).resolves.toMatchObject({
      domain: "softmato.com",
      senderName: "HostelHub",
    });
  });
});
