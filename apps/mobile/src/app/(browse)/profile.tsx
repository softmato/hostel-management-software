import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { readableRole } from "@/constants/roles";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSiteConfig } from "@/hooks/use-site-config";
import { API_BASE_URL } from "@/lib/api";
import { endSession } from "@/lib/auth-session";
import { absoluteMediaUrl } from "@/lib/media";
import { toastInfo } from "@/lib/toast";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Profile — and, since the tab bar replaced the signed-out shell, the app's
 * whole menu.
 *
 * ## What this screen is now
 *
 * The website's header and footer, natively. Everything they link to — Offer
 * Program, Register Hostel, Service Providers, About, Contact, Pricing, Terms,
 * Privacy, the support channels and the social links — is reachable from here,
 * grouped the way the site groups it: Explore, Partners, Company, Legal. On the
 * web those live in a nav bar and a four-column footer; a phone has neither, and
 * a menu is where a phone puts them.
 *
 * Privacy and Terms open **in the app**. They used to hand off to the browser,
 * which meant the one screen that answers "what do you do with my data" was the
 * one screen that left the product to answer it.
 *
 * ## Signed out is not a different app
 *
 * There is no signed-out shell any more. The same five tabs render for everyone,
 * and the only difference is the card at the top of this screen: an account, or
 * an invitation to make one. Everything below that card is identical, because
 * everything below it is either public (the documents, the partner pages) or
 * device-local (saved hostels, theme).
 *
 * That is deliberate and it is the reason the floating Log in pill is gone. The
 * pill sat over the home screen of someone who had come to look at hostels and
 * had nothing to sign in with, and it made the first thing the app asked for the
 * one thing a new user does not have.
 *
 * Rows that genuinely need a session — Notifications, Privacy & your data, sign
 * out — are hidden while signed out rather than shown and refused. Rows that
 * only *look* like they need one are not: `/settings` takes
 * `requireApiPrincipal`, so a browsing account reaches it like anybody else.
 *
 * ## The feature flags are honoured
 *
 * Compare, Inquiries, Hostel registration and Service-provider signup each have
 * a switch in Website Config, and the web header and footer drop their links
 * when it is off. So does this. A surface the platform owner has switched off
 * must not still be advertised on the phone.
 */
export default function BrowseProfileScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const saved = useAppSelector((state) => state.saved.items);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const { config, refresh, refreshing } = useSiteConfig();
  const [signingOut, setSigningOut] = useState(false);

  const { features, identity, social } = config;

  const soon = useCallback((what: string) => {
    toastInfo(`${what} is coming`, "It lands in the next release.");
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your password to get back in.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          setSigningOut(true);
          /*
           * Back to these same tabs, signed out — this screen simply redraws its
           * top card as the guest one. `replace` rather than nothing, because
           * `endSession` resets the store and the router has to remount the
           * group from the boot gate for the accent and the avatar tab to
           * follow; `endSession` only navigates on the server-driven path
           * (`onSessionEnded`), not on a deliberate sign-out.
           */
          void endSession().finally(() => router.replace("/(browse)"));
        },
        style: "destructive",
        text: "Sign out",
      },
    ]);
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";

  const socialLinks = (
    [
      ["Facebook", social.facebook],
      ["Instagram", social.instagram],
      ["YouTube", social.youtube],
      ["TikTok", social.tiktok],
      ["LinkedIn", social.linkedin],
      ["Website", social.website],
    ] as const
  ).filter(([, href]) => Boolean(href));

  return (
    <Screen
      header={<AppBar title="Profile" />}
      insideTabs
      onRefresh={refresh}
      refreshing={refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {account ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-3">
              {/* The shared component, which also handles a Google photo and a
                  photo URL that exists but cannot be drawn. */}
              <Avatar
                name={account.name}
                size="lg"
                uri={absoluteMediaUrl(account.image, API_BASE_URL)}
              />

              <View className="flex-1">
                <Text variant="subtitle">{account.name || "Your account"}</Text>
                <Text variant="caption">{account.email || account.phone || ""}</Text>
              </View>
            </View>

            <View className="border-t border-border pt-3">
              <Text variant="caption">
                {`${readableRole(account.role)} account — you're browsing, not living in a hostel yet.`}
              </Text>
            </View>
          </Card>
        ) : (
          /*
           * The sign-in card. It is the *only* thing on this screen that differs
           * between a signed-out reader and a signed-in one, and it sits at the
           * top so it is the first thing read — not floating over another screen
           * where it interrupts what someone came to do.
           */
          <Card className="gap-3">
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
                <Ionicons color={colors.primary} name="person-outline" size={22} />
              </View>
              <View className="flex-1">
                <Text variant="subtitle">You&apos;re browsing as a guest</Text>
                <Text variant="caption">
                  Sign in to send inquiries, post in the community and keep your
                  shortlist across devices.
                </Text>
              </View>
            </View>

            <View className="gap-2 border-t border-border pt-3">
              <Button label="Sign in" onPress={() => router.push("/(auth)/login")} />
              <Button
                label="Create account"
                onPress={() => router.push("/(auth)/register")}
                variant="outline"
              />
            </View>
          </Card>
        )}

        <View>
          <SectionHeader title="Your search" />
          <Card>
            {/*
              Saved hostels are real and **device-local** — the subtitle says so,
              because a shortlist that does not follow you to another phone is
              worth knowing about before you build one. It works signed out for
              the same reason: nothing about it touches an account.
            */}
            <ListRow
              icon="bookmark-outline"
              onPress={() => router.push("/(browse)")}
              right={
                saved.length > 0 ? (
                  <Badge label={String(saved.length)} tone="success" />
                ) : undefined
              }
              subtitle={
                saved.length > 0
                  ? "Kept on this device — shown on Home"
                  : "Tap the heart on a hostel to shortlist it"
              }
              title="Saved hostels"
            />

            {/*
              The one honest "not yet" left. `/public/inquiries` is a POST and
              nothing lists what you have sent, so this row would open onto a
              permanent empty state. Signed-in only — a guest has no inquiries to
              have a history of.
            */}
            {account ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="mail-outline"
                  onPress={() => soon("Your inquiries")}
                  subtitle="The hostels you've messaged"
                  title="Inquiries"
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Explore" />
          <Card>
            <ListRow
              icon="search-outline"
              onPress={() => router.push("/(browse)/search")}
              subtitle="Every verified listing, with filters and a map"
              title="Browse hostels"
            />
            {features.compare ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="git-compare-outline"
                  onPress={() => router.push("/(browse)/compare")}
                  subtitle="Put shortlisted hostels side by side"
                  title="Compare hostels"
                />
              </>
            ) : null}
            <RowDivider inset />
            <ListRow
              icon="people-outline"
              onPress={() => router.push("/(browse)/community")}
              subtitle="Ask, answer and see what residents are saying"
              title="Community"
            />
            {features.inquiries ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="chatbubble-ellipses-outline"
                  onPress={() => router.push("/inquiry")}
                  subtitle="Tell us what you need and we'll match you"
                  title="Send an inquiry"
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Programs" />
          <Card>
            <ListRow
              icon="sparkles-outline"
              onPress={() => router.push("/offer-program")}
              subtitle="How rent payments are matched, verified and receipted"
              title="Resident Offer Program"
            />
          </Card>
        </View>

        {features.publicRegistration || features.serviceProviderSignup ? (
          <View>
            <SectionHeader title="Partners" />
            <Card>
              {features.publicRegistration ? (
                <ListRow
                  icon="business-outline"
                  onPress={() => router.push("/register-hostel")}
                  subtitle="List your property and run it from one dashboard"
                  title="Register your hostel"
                />
              ) : null}
              {features.publicRegistration && features.serviceProviderSignup ? (
                <RowDivider inset />
              ) : null}
              {features.serviceProviderSignup ? (
                <ListRow
                  icon="construct-outline"
                  onPress={() => router.push("/service-providers")}
                  subtitle="Plumbing, electrical, cleaning — get matched with jobs"
                  title="Become a service provider"
                />
              ) : null}
              {features.publicRegistration ? (
                <>
                  <RowDivider inset />
                  <ListRow
                    icon="pricetags-outline"
                    onPress={() => router.push("/pricing")}
                    subtitle="What a listing costs, plan by plan"
                    title="Pricing"
                  />
                </>
              ) : null}
            </Card>
          </View>
        ) : null}

        <View>
          <SectionHeader title="App" />
          <Card>
            <ListRow
              icon={preference === "dark" ? "moon-outline" : "sunny-outline"}
              onPress={() => dispatch(setThemePreference(nextTheme))}
              subtitle={`Currently ${preference}`}
              title="Theme"
              value={`Switch to ${nextTheme}`}
            />
            {/*
              Both need a session. `/settings` itself takes `requireApiPrincipal`,
              so these are not shown-and-refused — they are simply not offered to
              someone who has no preferences to set and no account to delete.
            */}
            {account ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="notifications-outline"
                  onPress={() => router.push("/settings")}
                  subtitle="Choose what reaches you, and set quiet hours"
                  title="Notifications"
                />
                <RowDivider inset />
                <ListRow
                  icon="shield-checkmark-outline"
                  onPress={() => router.push("/settings")}
                  subtitle="Your data, and closing your account"
                  title="Privacy & your data"
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Company" />
          <Card>
            <ListRow
              icon="information-circle-outline"
              onPress={() => router.push("/about")}
              subtitle={`What ${identity.siteName} is for, and who builds it`}
              title="About us"
            />
            <RowDivider inset />
            <ListRow
              icon="chatbubbles-outline"
              onPress={() => router.push("/contact")}
              subtitle="Support channels, opening hours and answers"
              title="Contact"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Legal" />
          <Card>
            <ListRow
              icon="document-text-outline"
              onPress={() => router.push("/legal/terms")}
              subtitle="The rules you accept by using the platform"
              title="Terms & Regulations"
            />
            <RowDivider inset />
            <ListRow
              icon="lock-closed-outline"
              onPress={() => router.push("/legal/privacy")}
              subtitle="What we collect, why, and for how long"
              title="Privacy Policy"
            />
          </Card>
        </View>

        {/*
          The website's footer contact column. Tappable rather than printed: on a
          phone a support number is a call, not a string to memorise.
        */}
        {identity.supportPhone || identity.supportEmail || identity.address ? (
          <View>
            <SectionHeader title="Get in touch" />
            <Card>
              {identity.supportPhone ? (
                <ListRow
                  icon="call-outline"
                  onPress={() =>
                    void Linking.openURL(
                      `tel:${identity.supportPhone.replace(/\s/g, "")}`,
                    )
                  }
                  title={identity.supportPhone}
                />
              ) : null}
              {identity.supportPhone && identity.supportEmail ? (
                <RowDivider inset />
              ) : null}
              {identity.supportEmail ? (
                <ListRow
                  icon="mail-outline"
                  onPress={() => void Linking.openURL(`mailto:${identity.supportEmail}`)}
                  title={identity.supportEmail}
                />
              ) : null}
              {identity.address && (identity.supportPhone || identity.supportEmail) ? (
                <RowDivider inset />
              ) : null}
              {identity.address ? (
                <ListRow icon="location-outline" title={identity.address} />
              ) : null}
            </Card>
          </View>
        ) : null}

        {socialLinks.length > 0 ? (
          <View>
            <SectionHeader title="Follow" />
            <Card>
              {socialLinks.map(([label, href], index) => (
                <View key={label}>
                  {index > 0 ? <RowDivider inset /> : null}
                  <ListRow
                    icon="open-outline"
                    onPress={() => void Linking.openURL(href)}
                    title={label}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {account ? (
          <Card>
            <ListRow
              icon="log-out-outline"
              onPress={signOut}
              right={
                <Ionicons
                  color={colors.destructive}
                  name={signingOut ? "hourglass-outline" : "chevron-forward"}
                  size={18}
                />
              }
              title="Sign out"
            />
          </Card>
        ) : null}

        <Text className="pt-1 text-center" variant="caption">
          {`© ${new Date().getFullYear()} ${identity.siteName}. All rights reserved.`}
        </Text>
      </View>
    </Screen>
  );
}
