import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { InfoHeader } from "@/components/info-page";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSiteConfig } from "@/hooks/use-site-config";
import { API_BASE_URL } from "@/lib/api";
import { webPublicUrl } from "@/lib/web-portal";

/**
 * Plans, for a hostel owner.
 *
 * Every plan comes from Platform → Website Config → Pricing Plans, exactly as on
 * `/pricing` — the tiers, the prices, the feature lists, which one is
 * highlighted, and the label on its button. Nothing here is hardcoded, which is
 * why this is the one screen in the set with a real loading and error state:
 * plans are entirely owner-authored, and inventing three tiers as a fallback
 * would be fiction printed next to a currency symbol.
 *
 * ## What the website has and this does not
 *
 * The comparison table. Ten feature rows against three columns is a 4-column
 * grid at 360dp, and every honest way to draw it on a phone — horizontal scroll,
 * a column picker, stacked repeats — turns a glanceable table into a task. The
 * per-plan feature list above it carries the same information in the shape a
 * phone reads, so the table would be a second, harder copy of it.
 *
 * The FAQ is not here either — it is on the Contact screen, where the platform's
 * configured FAQ lives, rather than duplicated per page.
 */
export default function PricingScreen() {
  const { config, error, loading, refresh, refreshing } = useSiteConfig();
  const { identity, pricing } = config;
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  const openRegistration = useCallback(async () => {
    await WebBrowser.openBrowserAsync(webPublicUrl(API_BASE_URL, "registerHostel"));
  }, []);

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
          subtitle="Simple, transparent pricing built to support hostels of all sizes across Nepal."
          title="Choose the right plan"
        />

        <View className="flex-row flex-wrap justify-center gap-x-4 gap-y-2">
          {["No setup fees", "Cancel anytime", "Trusted by hostels across Nepal"].map(
            (claim) => (
              <Assurance key={claim} label={claim} />
            ),
          )}
        </View>

        {loading ? <LoadingState /> : null}

        {!loading && error && pricing.length === 0 ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : null}

        {!loading && !error && pricing.length === 0 ? (
          <EmptyState
            description="No plans have been published yet. Get in touch and we'll talk you through what a listing costs."
            title="Pricing is on its way"
          />
        ) : null}

        {pricing.map((plan) => (
          <PlanCard
            expanded={openPlan === plan.name}
            key={plan.name}
            onPress={() => void openRegistration()}
            onToggle={() => setOpenPlan(openPlan === plan.name ? null : plan.name)}
            plan={plan}
          />
        ))}

        {pricing.length > 0 ? (
          <Card className="gap-2 bg-brand-soft">
            <Text variant="subtitle">
              Ready to grow your hostel with {identity.siteName}?
            </Text>
            <Text className="leading-6" variant="muted">
              Join hostel owners across Nepal who use {identity.siteName} to manage room
              inventory, track resident fees, issue digital notices and publish
              listings.
            </Text>
            <Button
              className="mt-1"
              label="Start your registration"
              onPress={() => void openRegistration()}
            />
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

function Assurance({ label }: { label: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons color={colors.primary} name="checkmark" size={14} />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

/**
 * One plan.
 *
 * The feature list collapses. The website shows all of them at once because it
 * has three cards side by side and the page is as tall as it needs to be; here
 * they are stacked, and five open lists mean the third plan starts below two
 * screenfuls. The highlighted plan opens by default — it is the one the owner
 * wants read.
 */
function PlanCard({
  expanded,
  onPress,
  onToggle,
  plan,
}: {
  expanded: boolean;
  onPress: () => void;
  onToggle: () => void;
  plan: {
    ctaLabel: string;
    description: string;
    features: string[];
    highlighted: boolean;
    name: string;
    period: string;
    price: string;
  };
}) {
  const { colors } = useAppTheme();
  const open = expanded || plan.highlighted;

  return (
    <Card className={`gap-3 ${plan.highlighted ? "border-primary" : ""}`}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1" variant="subtitle">
          {plan.name}
        </Text>
        {plan.highlighted ? <Badge label="Most popular" tone="success" /> : null}
      </View>

      {plan.description ? <Text variant="caption">{plan.description}</Text> : null}

      <View className="flex-row items-baseline gap-1.5">
        <Text variant="display">{plan.price}</Text>
        <Text variant="caption">{plan.period}</Text>
      </View>

      {plan.features.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          {(open ? plan.features : plan.features.slice(0, 3)).map((feature) => (
            <View className="flex-row items-start gap-2" key={feature}>
              <Ionicons
                color={colors.primary}
                name="checkmark"
                size={16}
                style={{ marginTop: 2 }}
              />
              <Text className="flex-1" variant="muted">
                {feature}
              </Text>
            </View>
          ))}

          {plan.features.length > 3 && !plan.highlighted ? (
            <Button
              className="self-start"
              label={open ? "Show less" : `Show all ${plan.features.length}`}
              onPress={onToggle}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}

      <Button
        label={plan.ctaLabel || "Get started"}
        onPress={onPress}
        variant={plan.highlighted ? "primary" : "outline"}
      />
    </Card>
  );
}
