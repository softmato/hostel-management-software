"use client";

import { memo } from "react";

import {
  ConfigCard,
  ConfigPage,
  Repeater,
  TextAreaField,
  TextField,
  useSiteConfigDraft,
} from "./platform-config-shared";

export const PlatformConfigSitePageContent = memo(
  function PlatformConfigSitePageContent() {
    const {
      error,
      isDirty,
      message,
      reset,
      save,
      savingSection,
      setValue,
      state,
      valueFor,
    } = useSiteConfigDraft();

    const identity = valueFor("identity");
    const email = valueFor("email");
    const hero = valueFor("hero");
    const stats = valueFor("stats");
    const trustPoints = valueFor("trustPoints");

    return (
      <ConfigPage
        breadcrumb={["Home", "Website Config", "Site Content"]}
        description="Brand details, homepage hero copy, headline numbers, and trust points shown to every public visitor."
        error={error}
        message={message}
        state={state}
        title="Site Content"
      >
        <div className="space-y-4">
          <ConfigCard
            description="Used in the header, footer, page titles, and support links."
            dirty={isDirty("identity")}
            onReset={() => reset("identity")}
            onSave={() => save("identity")}
            saving={savingSection === "identity"}
            title="Site Identity"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Site name"
                onChange={(siteName) => setValue("identity", { ...identity, siteName })}
                value={identity.siteName}
              />
              <TextField
                label="Tagline"
                onChange={(tagline) => setValue("identity", { ...identity, tagline })}
                value={identity.tagline}
              />
              <TextField
                hint="Shown in the public footer and inquiry confirmations."
                label="Support email"
                onChange={(supportEmail) =>
                  setValue("identity", { ...identity, supportEmail })
                }
                value={identity.supportEmail}
              />
              <TextField
                label="Support phone"
                onChange={(supportPhone) =>
                  setValue("identity", { ...identity, supportPhone })
                }
                value={identity.supportPhone}
              />
              <TextField
                label="Address"
                onChange={(address) => setValue("identity", { ...identity, address })}
                value={identity.address}
              />
            </div>
          </ConfigCard>

          <ConfigCard
            description="Who transactional email comes from. Every field can be left blank — blank uses the sensible fallback shown in its hint, so this section only needs touching to override something."
            dirty={isDirty("email")}
            onReset={() => reset("email")}
            onSave={() => save("email")}
            saving={savingSection === "email"}
            title="Email Sending"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                hint={`Shown as the sender name. Blank uses the site name (${identity.siteName || "—"}).`}
                label="Sender name"
                onChange={(senderName) => setValue("email", { ...email, senderName })}
                placeholder={identity.siteName}
                value={email.senderName}
              />
              <TextField
                hint="Where replies go. Must be a mailbox that actually RECEIVES — a wrong address here does not fail on send, it bounces days later in someone else's inbox. Blank uses the general mailbox on the sending domain, which is the safe answer."
                label="Reply-to address"
                onChange={(replyTo) => setValue("email", { ...email, replyTo })}
                placeholder={`${email.infoMailbox || "info"}@${email.domain || "softmato.com"}`}
                value={email.replyTo}
              />
            </div>

            <TextField
              hint="Must be a domain VERIFIED IN RESEND — an unverified one bounces every email, it does not degrade. Blank uses the domain set on the server, which is the right answer unless you run your own."
              label="Sending domain"
              onChange={(domain) => setValue("email", { ...email, domain })}
              placeholder="softmato.com"
              value={email.domain}
            />

            <p className="text-xs text-slate-500">
              Mail is sent from a different mailbox depending on what it is, so a
              receipt and an emergency alert never arrive looking alike. Verifying
              the domain covers every mailbox on it for <em>sending</em> — but a
              reply only reaches a person if that address also exists as a
              forwarding alias. Replies are pointed at the general mailbox for
              that reason; no-reply mail carries no reply address at all.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                hint="Notices, approvals, invitations. Default: info"
                label="General mailbox"
                onChange={(infoMailbox) => setValue("email", { ...email, infoMailbox })}
                placeholder="info"
                value={email.infoMailbox}
              />
              <TextField
                hint="SOS, overdue fees, gateway outages. Default: alert"
                label="Alert mailbox"
                onChange={(alertMailbox) => setValue("email", { ...email, alertMailbox })}
                placeholder="alert"
                value={email.alertMailbox}
              />
              <TextField
                hint="Invoices, receipts, reminders. Default: billing"
                label="Billing mailbox"
                onChange={(billingMailbox) =>
                  setValue("email", { ...email, billingMailbox })
                }
                placeholder="billing"
                value={email.billingMailbox}
              />
              <TextField
                hint="OTPs, resets, credentials. Default: security"
                label="Security mailbox"
                onChange={(securityMailbox) =>
                  setValue("email", { ...email, securityMailbox })
                }
                placeholder="security"
                value={email.securityMailbox}
              />
              <TextField
                hint="Inquiries and complaint threads. Default: support"
                label="Support mailbox"
                onChange={(supportMailbox) =>
                  setValue("email", { ...email, supportMailbox })
                }
                placeholder="support"
                value={email.supportMailbox}
              />
              <TextField
                hint="Machine mail with no reply path. Default: noreply"
                label="No-reply mailbox"
                onChange={(noreplyMailbox) =>
                  setValue("email", { ...email, noreplyMailbox })
                }
                placeholder="noreply"
                value={email.noreplyMailbox}
              />
            </div>
          </ConfigCard>

          <ConfigCard
            description="The first thing visitors read on the homepage."
            dirty={isDirty("hero")}
            onReset={() => reset("hero")}
            onSave={() => save("hero")}
            saving={savingSection === "hero"}
            title="Homepage Hero"
          >
            <TextField
              label="Headline"
              onChange={(headline) => setValue("hero", { ...hero, headline })}
              value={hero.headline}
            />
            <TextAreaField
              label="Subheadline"
              onChange={(subheadline) => setValue("hero", { ...hero, subheadline })}
              rows={2}
              value={hero.subheadline}
            />
            <TextField
              label="Search placeholder"
              onChange={(searchPlaceholder) =>
                setValue("hero", { ...hero, searchPlaceholder })
              }
              value={hero.searchPlaceholder}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Primary button label"
                onChange={(primaryCtaLabel) =>
                  setValue("hero", { ...hero, primaryCtaLabel })
                }
                value={hero.primaryCtaLabel}
              />
              <TextField
                label="Primary button link"
                onChange={(primaryCtaHref) =>
                  setValue("hero", { ...hero, primaryCtaHref })
                }
                value={hero.primaryCtaHref}
              />
              <TextField
                label="Secondary button label"
                onChange={(secondaryCtaLabel) =>
                  setValue("hero", { ...hero, secondaryCtaLabel })
                }
                value={hero.secondaryCtaLabel}
              />
              <TextField
                label="Secondary button link"
                onChange={(secondaryCtaHref) =>
                  setValue("hero", { ...hero, secondaryCtaHref })
                }
                value={hero.secondaryCtaHref}
              />
            </div>
          </ConfigCard>

          <ConfigCard
            description="The counter strip under the hero. Values are shown exactly as typed."
            dirty={isDirty("stats")}
            onReset={() => reset("stats")}
            onSave={() => save("stats")}
            saving={savingSection === "stats"}
            title="Headline Stats"
          >
            <Repeater
              addLabel="Add stat"
              emptyLabel="No stats — the counter strip will be hidden."
              items={stats}
              makeItem={() => ({ label: "", suffix: "", value: "" })}
              max={8}
              onChange={(next) => setValue("stats", next)}
              renderRow={(stat, patch) => (
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <TextField
                    label="Value"
                    onChange={(value) => patch({ value })}
                    placeholder="1,248"
                    value={stat.value}
                  />
                  <TextField
                    label="Suffix"
                    onChange={(suffix) => patch({ suffix })}
                    placeholder="+"
                    value={stat.suffix}
                  />
                  <TextField
                    label="Label"
                    onChange={(label) => patch({ label })}
                    placeholder="Verified hostels"
                    value={stat.label}
                  />
                </div>
              )}
            />
          </ConfigCard>

          <ConfigCard
            description="The “why trust us” cards on the homepage."
            dirty={isDirty("trustPoints")}
            onReset={() => reset("trustPoints")}
            onSave={() => save("trustPoints")}
            saving={savingSection === "trustPoints"}
            title="Trust Points"
          >
            <Repeater
              addLabel="Add trust point"
              items={trustPoints}
              makeItem={() => ({ description: "", icon: "shield", title: "" })}
              max={12}
              onChange={(next) => setValue("trustPoints", next)}
              renderRow={(point, patch) => (
                <div className="space-y-2.5">
                  <div className="grid gap-2.5 sm:grid-cols-[1fr_140px]">
                    <TextField
                      label="Title"
                      onChange={(title) => patch({ title })}
                      value={point.title}
                    />
                    <TextField
                      hint="shield · wallet · star · users"
                      label="Icon"
                      onChange={(icon) => patch({ icon })}
                      value={point.icon}
                    />
                  </div>
                  <TextAreaField
                    label="Description"
                    onChange={(description) => patch({ description })}
                    rows={2}
                    value={point.description}
                  />
                </div>
              )}
            />
          </ConfigCard>
        </div>
      </ConfigPage>
    );
  },
);
