import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { APP_NAME, logo } from "@/constants/branding";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The signed-out home — the app's equivalent of the website's landing page.
 *
 * Same shape as `apps/web/src/app/_components/public-home-page.tsx`: a hero,
 * then verified hostels, then browse-by-type and browse-by-facility. The lists
 * are wired to `/public/hostels` in M6; the layout is here now so the shell
 * (safe areas, the Login footer, the theme) is settled before content lands on
 * top of it.
 */

const BROWSE_BY_TYPE = [
  { icon: "man-outline", label: "Boys" },
  { icon: "woman-outline", label: "Girls" },
  { icon: "people-outline", label: "Co-living" },
] as const;

const FACILITIES = [
  { icon: "wifi-outline", label: "Wi-Fi" },
  { icon: "restaurant-outline", label: "Meals" },
  { icon: "car-outline", label: "Parking" },
  { icon: "water-outline", label: "Hot water" },
] as const;

function HeroCard() {
  return (
    <View className="overflow-hidden rounded-3xl bg-primary px-5 py-7">
      <Image
        contentFit="contain"
        source={logo.markLight}
        style={{ height: 40, marginBottom: 14, width: 40 }}
      />
      <Text className="text-2xl font-semibold leading-8 text-primary-foreground">
        Find a hostel in Nepal you can actually trust.
      </Text>
      <Text className="mt-2 text-primary-foreground/80">
        Verified listings, real photos, honest pricing — and once you move in,
        your rent, meals and notices all live here too.
      </Text>

      <Pressable
        accessibilityRole="button"
        className="mt-5 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-white active:opacity-80"
        onPress={() => router.push("/(public)/hostels")}
      >
        <Ionicons color="#0a8a4b" name="search" size={18} />
        <Text className="font-semibold text-[#0a8a4b]">Search hostels</Text>
      </Pressable>
    </View>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <Card className="items-center py-7">
      <Text variant="muted">{label}</Text>
    </Card>
  );
}

export default function PublicHomeScreen() {
  const { colors } = useAppTheme();

  return (
    <Screen
      floating={
        <FloatingButton
          icon="log-in-outline"
          label="Log in"
          onPress={() => router.push("/(auth)/login")}
        />
      }
      header={
        <AppBar
          actions={
            <Pressable
              accessibilityLabel="Search"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.push("/(public)/hostels")}
            >
              <Ionicons color={colors.mutedForeground} name="search" size={22} />
            </Pressable>
          }
          subtitle="Hostels across Nepal"
          title={APP_NAME}
        />
      }
      scroll
    >
      <View className="gap-7 pt-1">
        <HeroCard />

        <View>
          <SectionHeader
            subtitle="Top-rated and verified hostels for students"
            title="Featured hostels"
          />
          <ComingSoon label="Listings arrive with M6" />
        </View>

        <View>
          <SectionHeader
            subtitle="Find a space that suits how you live"
            title="Browse by type"
          />
          <View className="flex-row gap-3">
            {BROWSE_BY_TYPE.map((type) => (
              <Card className="flex-1 items-center gap-2 py-5" key={type.label}>
                <Ionicons color={colors.primary} name={type.icon} size={24} />
                <Text variant="label">{type.label}</Text>
              </Card>
            ))}
          </View>
        </View>

        <View>
          <SectionHeader
            subtitle="Find hostels with what you need"
            title="Browse by facility"
          />
          <View className="flex-row flex-wrap gap-3">
            {FACILITIES.map((facility) => (
              <Card
                className="w-[47%] flex-row items-center gap-3 py-4"
                key={facility.label}
              >
                <Ionicons
                  color={colors.mutedForeground}
                  name={facility.icon}
                  size={20}
                />
                <Text variant="label">{facility.label}</Text>
              </Card>
            ))}
          </View>
        </View>

        <View>
          <SectionHeader
            subtitle="Already living in one of our hostels?"
            title="Residents"
          />
          <Card className="gap-3">
            <Text variant="muted">
              Sign in to see your rent, this week&apos;s meals, notices from your
              warden, and to raise a complaint.
            </Text>
            <Button
              label="Create an account"
              onPress={() => router.push("/(auth)/register")}
              variant="outline"
            />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
