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
