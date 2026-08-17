import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

/**
 * Handing a checkout to the wallet's own app, not to a browser tab.
 *
 * ## Why `Linking.openURL` and not the in-app browser
 *
 * `WebBrowser.openBrowserAsync` opens a Chrome Custom Tab (Android) or an
 * `SFSafariViewController` (iOS). Both are *browsers*: they load the launch URL
 * themselves and do not hand it to a native app that claims the domain. So a
 * resident with Khalti installed still ended up typing their Khalti password
 * into a web form — the worst of both, because the app already holds their
 * session, their saved balance and their biometric unlock, and the web form
 * holds none of it.
 *
 * `Linking.openURL` goes through the platform's intent resolution instead:
 * Android App Links and iOS Universal Links mean the wallet's app opens if it
 * has registered that host, and the default browser opens if it has not. No
 * scheme has to be hardcoded here, which matters — a guessed `esewa://` or
 * package name is the same class of mistake as inventing an API shape, and on
 * Android 11+ probing a scheme also needs a matching `<queries>` entry in the
 * manifest before `canOpenURL` will even answer honestly.
 *
 * ## The cost, stated
 *
 * This leaves our app rather than layering a tab over it, so there is no
 * built-in "done" affordance to come back with. That is why the checkout screen
 * polls: the browser closing was never evidence a payment happened, and neither
 * is the app being resumed. The provider is the only authority.
 *
 * ## What would be better
 *
 * `PaymentIntent.deeplinks` — `{ label, url }[]`, "deep links into wallet apps,
 * where the provider offers them" — is **declared in
 * `apps/web/src/modules/finance/gateway/provider.types.ts` and populated by
 * nothing**. No adapter sets it and `PaymentIntentView` does not return it, so
 * it never reaches a client. When it does, the app can offer a named "Open in
 * Khalti" button instead of relying on the OS to recognise a URL. That is the
 * right home for it: the server knows which provider it is talking to, and the
 * client should not be keeping a table of wallet schemes in step with six
 * vendors' release notes.
 */

export type HandoffRoute = "browser" | "system";

/**
 * Opens a checkout URL, preferring whatever native app claims it.
 *
 * Falls back to the in-app browser only if the platform refuses the URL
 * outright — which for an `https` link means something is badly wrong, not that
 * the wallet is missing. Returns which route was taken so the caller can say so.
 */
export async function openPaymentUrl(url: string): Promise<HandoffRoute> {
  try {
    await Linking.openURL(url);

    return "system";
  } catch {
    // No handler at all. A Custom Tab still renders the page, so the resident
    // can pay in a web form rather than being stopped.
    await WebBrowser.openBrowserAsync(url);

    return "browser";
  }
}
