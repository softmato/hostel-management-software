import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { idCardNoun } from "@/lib/id-card";
import type { IdCardType } from "@/lib/identity-api";

/**
 * The offer to create an ID card, for an account that has none.
 *
 * ## Why a sheet stands between the button and the form
 *
 * The web's header does this in one step — no card, so the tap opens the profile
 * form directly, with the pitch as the modal's own subtitle (`PROMPT_COPY` in
 * `resident-identity.tsx`). That works because a browser modal shows its title,
 * its subtitle and the first fields together. On a phone the form is a
 * full-screen scroll whose header is "Your details", and dropping someone into
 * thirty fields without first saying what they are for is how a form gets
 * abandoned on the first screen. So the pitch gets the sheet, and the sheet's
 * button opens the form.
 *
 * ## It names the right card
 *
 * A hostel owner and an approved service provider hold the same card in a
 * different variant, and `resolvePlatformIdCard` decides which server-side. The
 * caller derives the same answer from the cached account rather than fetching —
 * see `idCardTypeForAccount` — because the wording is needed at tap time.
 */
export function IdCardPrompt({
  cardType,
  onClose,
  open,
}: {
  cardType: IdCardType;
  onClose: () => void;
  open: boolean;
}) {
  const { colors } = useAppTheme();
  const noun = idCardNoun(cardType);

  const start = useCallback(() => {
    onClose();
    router.push("/id-card/edit");
  }, [onClose]);

  return (
    <Sheet onClose={onClose} open={open}>
      <View className="gap-5 pb-2 pt-2">
        <View className="items-center gap-3">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
            <Ionicons color={colors.primary} name="card-outline" size={26} />
          </View>
          <Text className="text-center" variant="title">
            Let&apos;s make your {noun} card
          </Text>
          <Text className="text-center" variant="muted">
            Fill your details in once and you get an ID with a QR code. Show it to
            a hostel and they can complete your registration without you filling
            in their form — ever again.
          </Text>
        </View>

        <View className="gap-3">
          <Point
            icon="shield-checkmark-outline"
            text="Stored encrypted against your account. A hostel only sees it when you show them the code."
          />
          <Point
            icon="qr-code-outline"
            text="Your card is ready the moment you save — QR code, ID number and all."
          />
        </View>

        <View className="gap-2">
          <Button label="Create my card" onPress={start} />
          <Button label="Not now" onPress={onClose} variant="ghost" />
        </View>
      </View>
    </Sheet>
  );
}

/** One reason, with its icon. Two of them; a third would be a features list. */
function Point({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row gap-3">
      <Ionicons color={colors.primary} name={icon} size={18} />
      <Text className="flex-1" variant="muted">
        {text}
      </Text>
    </View>
  );
}
