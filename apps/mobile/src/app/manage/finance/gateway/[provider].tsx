import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FactRow } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  type GatewayConfig,
  GATEWAY_PROVIDERS,
  type GatewayProviderName,
  listGateways,
  saveGateway,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { humanizeEnum } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One payment provider — eSewa, Fonepay or Khalti.
 *
 * Was a bottom sheet on the Finance screen. A sheet is right for a row's
 * overflow menu; it is wrong for six fields, two of them secrets, on a phone
 * where the keyboard takes half the sheet the moment one is focused.
 *
 * ## Secrets are write-only in both directions
 *
 * There is no field that returns a signing key and no code path that could. What
 * comes back is `{ configured, fingerprint, rotatedAt }` — enough to say "a key
 * is installed and it is this one" without saying what it is. So the inputs
 * start blank and blank means *keep the stored key*: sending an empty string is
 * refused by the server outright, which is why `save` omits them instead.
 *
 * ## Why a provider can be stored and still refused
 *
 * A personal wallet is not payable, ever — only a merchant account registered
 * with the provider is. The server says so in `blockedReason` rather than the
 * form hiding the option, because "I cannot find eSewa in the list" is a worse
 * problem than being told why the switch will not stay on.
 */

function isProvider(value: string): value is GatewayProviderName {
  return (GATEWAY_PROVIDERS as readonly string[]).includes(value);
}

export default function ManageGatewayScreen() {
  const dates = useDates();
  const params = useLocalSearchParams<{ provider?: string }>();
  const provider = params.provider && isProvider(params.provider) ? params.provider : null;

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const gateways = useResource<GatewayConfig[]>(useCallback(() => listGateways(), []));

  const entry = useMemo(
    () => (gateways.data ?? []).find((config) => config.provider === provider) ?? null,
    [gateways.data, provider],
  );

  const seeded = useMemo(
    () => ({
      accountKind: entry?.accountKind ?? "MERCHANT",
      merchantCode: entry?.merchantCode ?? "",
      mode: entry?.mode ?? "SANDBOX",
      secret: "",
      webhookSecret: "",
    }),
    [entry],
  );

  const form = draft ?? seeded;
  const enabled = enabledDraft ?? entry?.enabled ?? false;

  const edit = useCallback(
    (patch: Record<string, string>) => setDraft((prev) => ({ ...(prev ?? seeded), ...patch })),
    [seeded],
  );

  const save = useCallback(async () => {
    if (!provider) {
      return;
    }

    setBusy(true);

    try {
      await saveGateway({
        accountKind: (form.accountKind as "MERCHANT" | "PERSONAL") ?? "MERCHANT",
        enabled,
        merchantCode: form.merchantCode?.trim() || undefined,
        mode: (form.mode as "LIVE" | "SANDBOX") ?? "SANDBOX",
        provider,
        // Omitted rather than sent blank — the server reads an absent secret as
        // "leave the stored one alone" and rejects an empty string outright.
        secret: form.secret?.trim() || undefined,
        webhookSecret: form.webhookSecret?.trim() || undefined,
      });
      toastSuccess("Saved");
      router.back();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [enabled, form, provider]);

  const title = provider ? humanizeEnum(provider) : "Provider";
  const header = <AppBar accent centerTitle showBack title={title} />;

  if (!provider) {
    return (
      <Screen header={header}>
        <ErrorState message="That provider does not exist." onRetry={() => router.back()} />
      </Screen>
    );
  }

  if (gateways.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Reading the setup" />
      </Screen>
    );
  }

  if (gateways.error) {
    return (
      <Screen header={header}>
        <ErrorState message={gateways.error} onRetry={gateways.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={<Button label="Save" loading={busy} onPress={() => void save()} />}
      header={header}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text variant="label">Offer this to residents</Text>
              {entry?.blockedReason ? (
                <Text variant="caption">{entry.blockedReason}</Text>
              ) : null}
            </View>
            <Toggle
              accessibilityLabel="Offer this gateway to residents"
              onChange={setEnabledDraft}
              value={enabled}
            />
          </View>

          <View className="flex-row flex-wrap gap-2 border-t border-border pt-3">
            <Badge
              label={entry?.payable ? "Live for residents" : "Not taking payments"}
              tone={entry?.payable ? "success" : "neutral"}
            />
            <Badge
              label={entry?.secret.configured ? "Key installed" : "No key"}
              tone={entry?.secret.configured ? "success" : "warning"}
            />
          </View>
        </Card>

        <View>
          <SectionHeader title="Account" />
          <Card className="gap-3">
            <Select
              hint="A personal wallet is stored but can never take online payments — ask your bank for a merchant account."
              label="Account kind"
              onChange={(accountKind) => edit({ accountKind })}
              options={[
                {
                  description: "Registered with the provider.",
                  label: "Merchant",
                  value: "MERCHANT",
                },
                { description: "A personal wallet.", label: "Personal", value: "PERSONAL" },
              ]}
              value={form.accountKind}
            />
            <Input
              hint="eSewa's product code, Fonepay's merchant code. Khalti leaves it empty."
              label="Merchant code"
              onChangeText={(merchantCode) => edit({ merchantCode })}
              value={form.merchantCode}
            />
            <Select
              label="Mode"
              onChange={(mode) => edit({ mode })}
              options={[
                { description: "Test credentials.", label: "Sandbox", value: "SANDBOX" },
                { description: "Real money.", label: "Live", value: "LIVE" },
              ]}
              value={form.mode}
            />
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Blank keeps the key already stored" title="Keys" />
          <Card className="gap-3">
            <Input
              label="Signing secret"
              onChangeText={(secret) => edit({ secret })}
              placeholder="Unchanged"
              secure
              value={form.secret}
            />
            <Input
              hint="Only where the provider issues a second key for callbacks."
              label="Webhook secret"
              onChangeText={(webhookSecret) => edit({ webhookSecret })}
              placeholder="Unchanged"
              secure
              value={form.webhookSecret}
            />
          </Card>
        </View>

        {entry?.health || entry?.lastVerifiedAt ? (
          <View>
            <SectionHeader title="Status" />
            <Card className="gap-1">
              {entry.health ? (
                <FactRow
                  label="Health"
                  value={entry.health.detail ?? humanizeEnum(entry.health.status)}
                />
              ) : null}
              {entry.lastVerifiedAt ? (
                <FactRow label="Last checked" value={dates.date(entry.lastVerifiedAt)} />
              ) : null}
              {entry.lastEventAt ? (
                <FactRow label="Last payment" value={dates.date(entry.lastEventAt)} />
              ) : null}
            </Card>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
