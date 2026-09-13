import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Lottie } from "@/components/ui/lottie";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { idCardNoun } from "@/lib/id-card";
import type { IdCardType } from "@/lib/identity-api";

/** The header card button's invitation to make an ID: one animation, one line, one action. */
export function IdCardPrompt({
  cardType,
  onClose,
  open,
}: {
  cardType: IdCardType;
  onClose: () => void;
  open: boolean;
}) {
  const start = useCallback(() => {
    onClose();
    router.push("/id-card/edit");
  }, [onClose]);

  return (
    <Sheet onClose={onClose} open={open}>
      <View className="gap-5 pb-2 pt-1">
        <View className="items-center gap-3">
          <Lottie loop={false} size={150} source={require("../../assets/lottie/id-card-creation-shett.lottie")} />
          <Text className="text-center" variant="title">
            Let&apos;s make your {idCardNoun(cardType)} card
          </Text>
          <Text className="text-center" variant="muted">
            Fill it in once. Any hostel registers you from its QR code.
          </Text>
        </View>

        <View className="gap-3">
          <Point
            delay={250}
            icon="shield-checkmark-outline"
            text="Stored encrypted against your account. A hostel only sees it when you show them the code."
          />
          <Point
            delay={400}
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

/** The sheet's content mounts each time it opens, so the icon pops in once per open. */
function Point({
  delay,
  icon,
  text,
}: {
  delay: number;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row gap-3">
      <Animated.View entering={ZoomIn.delay(delay).springify().reduceMotion(ReduceMotion.System)}>
        <Ionicons color={colors.primary} name={icon} size={18} />
      </Animated.View>
      <Text className="flex-1" variant="muted">
        {text}
      </Text>
    </View>
  );
}
