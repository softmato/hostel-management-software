"use client";

import { memo } from "react";

import { ToggleSwitch } from "@/app/_components/portal-dashboard-ui";
import {
  ConfigCard,
  ConfigPage,
  Repeater,
  TextAreaField,
  TextField,
  parseListField,
  useSiteConfigDraft,
} from "./platform-config-shared";

export const PlatformConfigPricingPageContent = memo(
  function PlatformConfigPricingPageContent() {
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

    const pricing = valueFor("pricing");

    return (
      <ConfigPage
        breadcrumb={["Home", "Website Config", "Pricing Plans"]}
        description="The plans rendered on the public pricing page. Prices are shown exactly as typed, so include the currency."
        error={error}
        message={message}
        state={state}
        title="Pricing Plans"
      >
        <ConfigCard
          description="Exactly one plan should be highlighted — it renders as the featured column."
          dirty={isDirty("pricing")}
          onReset={() => reset("pricing")}
          onSave={() => save("pricing")}
          saving={savingSection === "pricing"}
          title="Public Plans"
        >
          <Repeater
            addLabel="Add plan"
            emptyLabel="No plans configured — the public pricing page will show nothing."
            items={pricing}
            makeItem={() => ({
              ctaHref: "/register-hostel",
              ctaLabel: "Get Started",
              description: "",
              enabled: true,
              features: [],
              highlighted: false,
              name: "",
              period: "per month",
              price: "",
            })}
            max={8}
            onChange={(next) => setValue("pricing", next)}
            renderRow={(plan, patch) => (
              <div className="space-y-2.5">
                {/* An off plan keeps its content but disappears from the public
                    site — dim the row so that is obvious at a glance. */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {plan.enabled
                      ? "Live on the public pricing page."
                      : "Turned off — hidden from the public site."}
                  </p>
                  <ToggleSwitch
                    checked={plan.enabled}
                    label="Plan active"
                    onChange={(enabled) => patch({ enabled })}
                  />
                </div>

                <div
                  className={
                    plan.enabled ? "space-y-2.5" : "space-y-2.5 opacity-55 grayscale"
                  }
                >
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <TextField
                    label="Plan name"
                    onChange={(name) => patch({ name })}
                    placeholder="Pro"
                    value={plan.name}
                  />
                  <TextField
                    label="Price"
                    onChange={(price) => patch({ price })}
                    placeholder="NPR 8,500"
                    value={plan.price}
                  />
                  <TextField
                    label="Period"
                    onChange={(period) => patch({ period })}
                    placeholder="per month"
                    value={plan.period}
                  />
                </div>

                <TextAreaField
                  label="Description"
                  onChange={(description) => patch({ description })}
                  rows={2}
                  value={plan.description}
                />

                <TextAreaField
                  hint="One per line, or comma separated."
                  label="Features"
                  onChange={(value) => patch({ features: parseListField(value) })}
                  rows={4}
                  value={plan.features.join("\n")}
                />

                <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_180px]">
                  <TextField
                    label="Button label"
                    onChange={(ctaLabel) => patch({ ctaLabel })}
                    value={plan.ctaLabel}
                  />
                  <TextField
                    label="Button link"
                    onChange={(ctaHref) => patch({ ctaHref })}
                    value={plan.ctaHref}
                  />
                  <ToggleSwitch
                    checked={plan.highlighted}
                    label="Featured plan"
                    onChange={(highlighted) => patch({ highlighted })}
                  />
                </div>
                </div>
              </div>
            )}
          />
        </ConfigCard>
      </ConfigPage>
    );
  },
);
