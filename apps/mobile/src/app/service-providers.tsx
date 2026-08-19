import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { View } from "react-native";

import { DocumentScreen } from "@/components/document-screen";
import { InfoNote } from "@/components/info-page";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { API_BASE_URL } from "@/lib/api";
import { webPublicUrl } from "@/lib/web-portal";

/**
 * "Become a service provider" — the app's version of `/service-providers`.
 *
 * The pitch, the stat strip and the three sections are the platform's configured
 * copy, shared with the website's hero. What is different is who is reading:
 * this screen is inside the app an approved provider will actually work from, so
 * it can say that plainly, and it can recognise a provider who has already been
 * approved instead of inviting them to apply twice.
 *
 * The application itself is gated on Google sign-in before the form — that gate
 * is what upgrades the account, so it stays on the web (see `WEB_PUBLIC_PATHS`).
 */
export default function ServiceProvidersScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const isApproved = Boolean(account?.isServiceProvider);

  const openForm = useCallback(async () => {
    await WebBrowser.openBrowserAsync(webPublicUrl(API_BASE_URL, "becomeProvider"));
  }, []);

  return (
    <DocumentScreen
      extra={
        isApproved ? (
          /*
           * Already approved. The website has no provider dashboard by design —
           * this app is it — so the honest thing to show is not "apply" but
           * where the work is.
           */
          <InfoNote title="You are an approved provider" tone="accent">
            <Text className="leading-6" variant="muted">
              Jobs broadcast by hostels in your trades and area arrive in this app.
              There is nothing else to apply for.
            </Text>
          </InfoNote>
        ) : (
          <InfoNote title="Apply to join" tone="accent">
            <Text className="leading-6" variant="muted">
              The application starts with a Google sign-in, so the email hostels reach
              you on is one Google has verified. That step opens on the web; once you
              are approved, every job comes to you here.
            </Text>
            <View className="mt-1">
              <Button
                label="Apply as a service provider"
                onPress={() => void openForm()}
              />
            </View>
          </InfoNote>
        )
      }
      icon="construct-outline"
      page="serviceProviders"
      webPath="service-providers"
      title="Service providers"
    />
  );
}
