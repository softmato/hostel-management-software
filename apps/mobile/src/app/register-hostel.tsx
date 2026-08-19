import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { DocumentScreen } from "@/components/document-screen";
import { InfoNote } from "@/components/info-page";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { API_BASE_URL } from "@/lib/api";
import { webPublicUrl } from "@/lib/web-portal";

/**
 * "Register your hostel" — the app's version of the website's owner landing
 * page.
 *
 * The nine features, the stat strip and the closing pitch are the platform's
 * configured copy, so this screen and `/register-hostel` say the same things
 * about the same product. What the website surrounds them with — a scrambling
 * wordmark, a six-slide hero carousel, alternating feature images — is not
 * ported. Those are a desktop marketing page's furniture; on a phone they cost
 * the first two screenfuls of a screen whose job is to explain the product.
 * Same argument the discovery home already settled (see
 * `screens-show-data-not-marketing`).
 *
 * ## The form itself opens in the browser, and says so
 *
 * The application is multi-step and wants ownership documents that live on a
 * computer — see `WEB_PUBLIC_PATHS`. Rather than a half-native form that gives
 * up at the upload step, the whole explanation is here and only the form leaves.
 * The button names the destination so nobody is surprised by a browser opening.
 */
export default function RegisterHostelScreen() {
  const openForm = useCallback(async () => {
    await WebBrowser.openBrowserAsync(webPublicUrl(API_BASE_URL, "registerHostel"));
  }, []);

  return (
    <DocumentScreen
      extra={
        <InfoNote title="Ready to bring your hostel online?" tone="accent">
          <Text className="leading-6" variant="muted">
            The application asks for your hostel&apos;s details and its ownership papers,
            so it opens on the web where those files are. It takes about ten minutes
            and you can come back to it.
          </Text>
          <View className="mt-1 gap-2">
            <Button label="Start your registration" onPress={() => void openForm()} />
            <Button
              label="Browse hostels first"
              onPress={() => router.push("/(browse)/search")}
              variant="outline"
            />
          </View>
        </InfoNote>
      }
      icon="business-outline"
      page="registerHostel"
      webPath="register-hostel"
      title="Register your hostel"
    />
  );
}
