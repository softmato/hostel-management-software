/**
 * What redeemed the code, and from what build.
 *
 * `POST /resident/activate` stores `deviceInfo` and `sessionInfo` verbatim on
 * the `QRActivation` row (`activation.service.ts`), and both are
 * `z.record(z.string(), z.unknown())` — free-form. The web sends
 * `{ source: "web" }`; this is the mobile counterpart, so a row can be told
 * apart by where it came from.
 *
 * ## Nothing renders this yet
 *
 * No admin screen reads `QRActivation.deviceInfo` today — the only reader of a
 * `deviceInfo.fingerprint` anywhere is `operations-analytics.service.ts`, and
 * that is `FoodReadyLog`, a different collection. So this is a record written
 * for the audit trail and for the support question "which phone claimed this
 * code", not a feature with a screen. It is worth writing now because the
 * answer cannot be reconstructed later; it is not worth claiming as a shipped
 * admin feature. `fingerprint` uses that existing key name so a panel that
 * eventually reads both finds the same shape.
 *
 * ## What is deliberately not collected
 *
 * No location, no phone number, no advertising id, no contacts. The identifier
 * is the OS-provided per-install id — the same one an uninstall resets — which
 * is enough to say "this handset, this install" and nothing more.
 */

import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

/**
 * Best-effort by design: every field is optional and every call is guarded.
 * A device that will not report its model must still be able to activate — the
 * fingerprint is a note in an audit log, and failing the activation over it
 * would trade a working sign-in for a diagnostic.
 */
export async function collectDeviceInfo(): Promise<Record<string, unknown>> {
  return {
    appVersion: Application.nativeApplicationVersion ?? undefined,
    brand: Device.brand ?? undefined,
    buildVersion: Application.nativeBuildVersion ?? undefined,
    fingerprint: (await installationId()) ?? undefined,
    isDevice: Device.isDevice,
    model: Device.modelName ?? undefined,
    os: Platform.OS,
    osVersion: Device.osVersion ?? undefined,
    source: "mobile",
  };
}

/** When the redemption happened, by the device's own clock. */
export function collectSessionInfo(): Record<string, unknown> {
  return {
    activatedAt: new Date().toISOString(),
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
  };
}

/**
 * The per-install identifier, which is a different API on each platform and
 * absent on web.
 *
 * Android's `getAndroidId()` is scoped to the app's signing key; iOS's
 * "id for vendor" is scoped to the vendor and is `null` in some restore states.
 * Neither is a hardware serial, and both reset on uninstall.
 */
async function installationId(): Promise<string | null> {
  try {
    if (Platform.OS === "android") {
      return Application.getAndroidId();
    }

    if (Platform.OS === "ios") {
      return await Application.getIosIdForVendorAsync();
    }

    return null;
  } catch {
    return null;
  }
}
