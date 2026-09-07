import { Ionicons } from "@expo/vector-icons";
import {
  bestDiscountPercent,
  billingCycles,
  cardServicesForPlan,
  cycleTotal,
  monthlyRateFor,
  planBelow,
  portalAccessLines,
  residentRangeLabel,
  savingFor,
  type BillingCycle,
  type PlanTierLike,
} from "@hostel/plans/catalog";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { InfoHeader } from "@/components/info-page";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSiteConfig } from "@/hooks/use-site-config";
import type { SitePlans } from "@/lib/site-config-api";

/**
 * Plans, for a hostel owner.
 *
 * Everything comes from Platform → Website Config → Plans & Pricing — the same
 * `plans` section the website's `/plans-pricing` renders — and every figure on
 * this screen is computed by `@hostel/plans/catalog`, the same file the website
 * calls. A plan carries one monthly price and a discount per longer cycle; the
 * six-month and annual totals are derived, so the app and the site cannot quote
 * different numbers.
 *
 * Nothing here is hardcoded, which is why this is the one screen in the set with
 * a real loading and error state: plans are entirely owner-authored, and
 * inventing three tiers as a fallback would be fiction printed next to a
 * currency symbol.
 *
 * ## What the website has and this does not
 *
 * The comparison table. Ten feature rows against three columns is a 4-column
 * grid at 360dp, and every honest way to draw it on a phone — horizontal
 * scroll, a column picker, stacked repeats — turns a glanceable table into a
 * task. The per-plan feature list carries the same information in the shape a
 * phone reads, so the table would be a second, harder copy of it.
 *
 * The per-service detail pages are not here either. They are a page each on the
 * website; on a phone they belong behind the service rows rather than as forty
 * screens reachable only from a pricing list — see `tasks.md`.
 *
 * The FAQ is on the Contact screen, where the platform's configured FAQ lives,
 * rather than duplicated per page.
 */
export default function PricingScreen() {
  const { config, error, loading, refresh, refreshing } = useSiteConfig();
  const { identity, plans: catalog } = config;
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  /*
   * The registration wizard, in the app. This was a browser tab until 2026-08-19
   * — see `register-hostel/apply.tsx` for why the "the documents are on a
   * computer" argument did not survive contact with the device.
   */
  const openRegistration = useCallback(() => {
    router.push("/register-hostel/apply");
  }, []);

  const empty = catalog.plans.length === 0;
  const bestDiscount = bestDiscountPercent(catalog, cycle);

  return (
    <Screen
      header={<AppBar showBack title="Pricing" />}
      onRefresh={refresh}
      refreshing={refreshing}
      scroll
    >
      <View className="gap-8 pb-4">
        <InfoHeader
          icon="pricetags-outline"
          subtitle={catalog.page.subtitle}
          title={catalog.page.title}
        />

        {loading ? <LoadingState /> : null}

        {!loading && error && empty ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : null}

        {!loading && !error && empty ? (
          <EmptyState
            description="No plans have been published yet. Get in touch and we'll talk you through what a listing costs."
            title="Pricing is on its way"
          />
        ) : null}

        {empty ? null : (
          <View className="gap-3">
            <Segmented
              onChange={setCycle}
              options={billingCycles(catalog).map((option) => ({
                label: option.label,
                value: option.id,
              }))}
              value={cycle}
            />
            {/* Never on monthly: a saving on screen while monthly is selected
                advertises a discount the reader is not currently getting. */}
            {cycle !== "monthly" && bestDiscount > 0 ? (
              <Text className="text-center" variant="caption">
                Save up to {bestDiscount}% by paying up front.
              </Text>
            ) : null}
          </View>
        )}

        {catalog.plans.map((plan) => (
          <PlanCard
            catalog={catalog}
            cycle={cycle}
            expanded={openPlan === plan.id}
            key={plan.id}
            onPress={openRegistration}
            onToggle={() => setOpenPlan(openPlan === plan.id ? null : plan.id)}
            plan={plan}
            featuredBadge={catalog.page.featuredBadge}
          />
        ))}

        {catalog.page.footnote ? (
          <Text className="text-center" variant="caption">
            {fill(catalog.page.footnote, identity.siteName)}
          </Text>
        ) : null}

        {empty ? null : (
          <Card className="gap-2 bg-brand-soft">
            <Text variant="subtitle">
              {fill(catalog.page.ctaTitle, identity.siteName)}
            </Text>
            <Text className="leading-6" variant="muted">
              {fill(catalog.page.ctaBody, identity.siteName)}
            </Text>
            <Button
              className="mt-1"
              label="Start your registration"
              onPress={openRegistration}
            />
          </Card>
        )}
      </View>
    </Screen>
  );
}

/**
 * Stored copy cannot interpolate, so it carries `{siteName}` and the client
 * replaces it — the same two braces the website substitutes, so an owner who
 * renames the platform renames it in both.
 */
function fill(text: string, siteName: string) {
  return text.replaceAll("{siteName}", siteName);
}

function money(rupees: number) {
  return `NPR ${rupees.toLocaleString("en-IN")}`;
}

/**
 * One plan.
 *
 * The feature list collapses. The website shows all of them at once because it
 * has three cards side by side and the page is as tall as it needs to be; here
 * they are stacked, and five open lists mean the third plan starts below two
 * screenfuls. The highlighted plan opens by default — it is the one the owner
 * wants read.
 *
 * The lines are built the way the website builds them: the resident ceiling
 * first, because it is what the price is set by, then who gets an account per
 * role, then the badge, then what this plan adds over the one below it.
 */
function PlanCard({
  catalog,
  cycle,
  expanded,
  featuredBadge,
  onPress,
  onToggle,
  plan,
}: {
  catalog: SitePlans;
  cycle: BillingCycle;
  expanded: boolean;
  featuredBadge: string;
  onPress: () => void;
  onToggle: () => void;
  plan: PlanTierLike;
}) {
  const { colors } = useAppTheme();
  const open = expanded || plan.featured;
  const below = planBelow(catalog, plan.id);

  const lines = [
    residentRangeLabel(catalog, plan),
    ...portalAccessLines(catalog, plan).map((line) => line.label),
    ...(plan.listingTier ? [`${plan.listingTier.label} badge`] : []),
    ...cardServicesForPlan(catalog, plan.id).map((service) => service.name),
  ];

  return (
    <Card className={`gap-3 ${plan.featured ? "border-primary" : ""}`}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1" variant="subtitle">
          {plan.name}
        </Text>
        {plan.featured ? <Badge label={featuredBadge} tone="success" /> : null}
      </View>

      {plan.description ? <Text variant="caption">{plan.description}</Text> : null}

      <View className="gap-1">
        <View className="flex-row items-baseline gap-1.5">
          <Text variant="display">{money(monthlyRateFor(plan, cycle))}</Text>
          <Text variant="caption">per month</Text>
        </View>
        <Text variant="caption">
          {cycle === "monthly"
            ? "Paid every month."
            : `${money(cycleTotal(plan, cycle))} paid once — saving ${money(
                savingFor(plan, cycle),
              )}.`}
        </Text>
      </View>

      {lines.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <Text variant="caption">
            {below ? `Everything in ${below.name}, plus:` : "Included:"}
          </Text>

          {(open ? lines : lines.slice(0, 3)).map((line) => (
            <View className="flex-row items-start gap-2" key={line}>
              <Ionicons
                color={colors.primary}
                name="checkmark"
                size={16}
                style={{ marginTop: 2 }}
              />
              <Text className="flex-1" variant="muted">
                {line}
              </Text>
            </View>
          ))}

          {lines.length > 3 && !plan.featured ? (
            <Button
              className="self-start"
              label={open ? "Show less" : `Show all ${lines.length}`}
              onPress={onToggle}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}

      <Button
        className="mt-1"
        label={plan.ctaLabel}
        onPress={onPress}
        variant={plan.featured ? "primary" : "outline"}
      />
    </Card>
  );
}
