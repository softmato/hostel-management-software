import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback } from "react";
import { Pressable, Share, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { API_BASE_URL } from "@/lib/api";
import { formatMoney, humanizeEnum } from "@/lib/format";
import {
  type Referral,
  type ResidentReferral,
  getResidentReferral,
} from "@/lib/referral-api";
import {
  buildReferralShare,
  describeRewards,
  referralShareUrl,
  referralStatusLabel,
  referralTiles,
} from "@/lib/referrals";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Refer a friend.
 *
 * Structure follows `apps/web/src/app/_components/resident-referral-page.tsx`:
 * the code in large tracked type, the share row, the three tiles (Sent · Joined ·
 * Converted) with its hint copy, the rewards sentence, then the referred-inquiry
 * list with a status badge each. Only the controls are native — the web's
 * "Copy link" becomes a share sheet, and its three-column tile grid becomes a row.
 *
 * ## The share sends the code, not the link
 *
 * The web copies `/inquiry?ref=<code>` to the clipboard, and the page that link
 * opens ignores `ref` — so following it credits nobody. Rather than reproduce a
 * control that silently costs the resident a reward, the share sends the **code**,
 * which works both in this app (`app/ref/[code].tsx`) and at the hostel desk
 * (`linkReferralOnRegistration`). The link is still shown, labelled as needing the
 * website, so the resident is not misled about which is which. Reasoning and the
 * unwind condition are in `lib/referrals.ts`.
 *
 * ## Opening this screen is what mints the code
 *
 * `getResidentReferral` creates the `ReferralCode` if there is none — in the GET.
 * So there is no "generate my code" button to build, and a resident who has never
 * referred anybody still lands on a real code.
 */

export default function ReferralsScreen() {
  const referral = useResource<ResidentReferral>(
    useCallback(() => getResidentReferral(), []),
  );

  const header = <AppBar showBack title="Refer a friend" />;

  if (referral.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Getting your code" />
      </Screen>
    );
  }

  if (referral.error || !referral.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={referral.error ?? "Your referral code could not be loaded."}
          onRetry={referral.reload}
        />
      </Screen>
    );
  }

  return <ReferralBody data={referral.data} header={header} resource={referral} />;
}

function ReferralBody({
  data,
  header,
  resource,
}: {
  data: ResidentReferral;
  header: React.ReactNode;
  resource: { refresh: () => void; refreshing: boolean };
}) {
  const { colors } = useAppTheme();
  const { referralCode, referrals, summary } = data;

  const shareUrl = referralShareUrl(referralCode.link, API_BASE_URL);

  const copyCode = useCallback(async () => {
    await Clipboard.setStringAsync(referralCode.code);
    toastSuccess("Code copied");
  }, [referralCode.code]);

  const share = useCallback(async () => {
    try {
      await Share.share({
        message: buildReferralShare({ code: referralCode.code }),
      });
    } catch {
      // Dismissed, or the platform refused. The code is on screen and copyable,
      // so there is nothing worth interrupting anybody about.
    }
  }, [referralCode.code]);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(shareUrl);
    toastError(
      "Link copied — but read this",
      "This link only works once the website supports referral links. Share the code instead.",
    );
  }, [shareUrl]);

  return (
    <Screen
      header={header}
      onRefresh={resource.refresh}
      refreshing={resource.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="items-center gap-3">
          <View className="flex-row items-center gap-2">
            <Ionicons color={colors.primary} name="gift-outline" size={18} />
            <Text variant="label">Your referral code</Text>
          </View>

          <Pressable
            accessibilityHint="Copies the code"
            accessibilityLabel={`Referral code ${referralCode.code}`}
            accessibilityRole="button"
            className="active:opacity-70"
            onPress={() => void copyCode()}
          >
            <Text
              className="text-center"
              style={{
                color: colors.primary,
                fontSize: 34,
                fontWeight: "800",
                letterSpacing: 4,
              }}
            >
              {referralCode.code}
            </Text>
          </Pressable>

          <Text className="text-center" variant="caption">
            Tap to copy. Give it to a friend when they register, or they can enter
            it in the app.
          </Text>

          <Pressable
            accessibilityRole="button"
            className="mt-1 h-11 w-full flex-row items-center justify-center gap-2 rounded-xl active:opacity-85"
            onPress={() => void share()}
            style={{ backgroundColor: colors.primary }}
          >
            <Ionicons color={colors.primaryForeground} name="share-social" size={17} />
            <Text
              className="font-semibold"
              style={{ color: colors.primaryForeground }}
            >
              Share my code
            </Text>
          </Pressable>
        </Card>

        <View className="flex-row gap-2">
          {referralTiles(summary).map((tile) => (
            <Card className="flex-1 gap-0.5 p-3" key={tile.label}>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 10,
                  fontWeight: "600",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                {tile.label}
              </Text>
              <Text variant="subtitle">{tile.value}</Text>
              <Text variant="caption">{tile.hint}</Text>
            </Card>
          ))}
        </View>

        <Card className="gap-1">
          <Text variant="label">Rewards</Text>
          <Text variant="muted">
            {describeRewards(summary, referralCode.rewardCount)}
          </Text>
        </Card>

        {/*
          Shown, but honestly labelled. The web copies this link as the primary
          action; the page it opens ignores `ref`, so presenting it the same way
          here would cost the resident the reward they are on this screen to earn.
        */}
        <View>
          <SectionHeader
            subtitle="Needs a website change before it credits anyone"
            title="Your link"
          />
          <Card className="gap-2">
            <Text numberOfLines={1} variant="caption">
              {shareUrl}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-1.5 self-start active:opacity-70"
              onPress={() => void copyLink()}
            >
              <Ionicons color={colors.mutedForeground} name="copy-outline" size={14} />
              <Text variant="caption">Copy anyway</Text>
            </Pressable>
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle={
              referrals.length === 1 ? "1 referral" : `${referrals.length} referrals`
            }
            title="Who you have referred"
          />

          {referrals.length === 0 ? (
            <EmptyState
              description="Share your code and anyone who inquires with it shows up here."
              title="No referrals yet"
            />
          ) : (
            <View className="gap-3">
              {referrals.map((referral) => (
                <ReferralRow key={referral.id} referral={referral} />
              ))}
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

function ReferralRow({ referral }: { referral: Referral }) {
  const dates = useDates();

  const reward = referral.reward;

  return (
    <Card className="gap-2">
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          <Text variant="subtitle">{referral.name}</Text>
          <Text variant="caption">{referral.phone}</Text>
        </View>

        <View className="items-end gap-1">
          <StatusPill status={referral.status} />
          {/*
            `converted` is a separate field, not a later stage of `status` — a
            JOINED referral may or may not have a verified first payment, and this
            is the one that means money.
          */}
          {referral.converted ? <Badge label="Converted" tone="success" /> : null}
        </View>
      </View>

      <View className="flex-row items-center gap-2">
        <Text variant="caption">{referralStatusLabel(referral.status)}</Text>
        <View className="flex-1" />
        <Text variant="caption">{dates.relativeDay(referral.createdAt)}</Text>
      </View>

      {reward && reward.amount > 0 ? (
        <View className="flex-row items-center gap-2 border-t border-border pt-2">
          <Text variant="label">{formatMoney(reward.amount)}</Text>
          <Badge label={humanizeEnum(reward.rewardType)} />
          <StatusPill status={reward.status} />
        </View>
      ) : null}
    </Card>
  );
}
