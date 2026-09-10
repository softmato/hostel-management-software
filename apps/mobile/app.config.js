/**
 * A thin overlay on `app.json`, for the fields that cannot live there.
 *
 * `app.json` stays the source of truth — Expo reads it first and hands it to
 * this function as `config`, so everything below is a targeted override rather
 * than a second copy of the manifest drifting away from the first.
 *
 * ## Why `googleServicesFile` needs a function at all
 *
 * The Google Services Gradle plugin reads `google-services.json` at build time
 * to give Android the FCM project it should register against. Without it, an
 * Android build either fails outright or produces an app that can never receive
 * a push.
 *
 * That file is **gitignored** (see `.gitignore` for the reasoning — this repo is
 * public and the key inside is scraped), so an EAS build has no copy of it in the
 * uploaded archive. EAS's answer is a **file-type environment variable**: the
 * file is uploaded once, and at build time EAS writes it into the working
 * directory and sets `GOOGLE_SERVICES_JSON` to its path. Reading that path is
 * something only a config *function* can do, which is the whole reason this file
 * exists.
 *
 * Locally the variable is unset and the checked-out file is used, so
 * `expo start`, `expo run:android` and `expo export` behave exactly as before.
 *
 * To (re)upload after changing the file:
 *
 *   eas env:create --name GOOGLE_SERVICES_JSON --type file \
 *     --value ./google-services.json --visibility secret \
 *     --environment preview --environment production --force
 *
 * ## Why the Google sign-in plugin is registered here and not in `app.json`
 *
 * On Android the native module is autolinked and takes everything from
 * `configure()` at runtime, so no plugin is needed — see `src/lib/google-auth.ts`.
 * iOS is different: Google's SDK completes sign-in by opening a URL back into
 * the app, and that URL's scheme has to be declared in `CFBundleURLTypes` at
 * **build** time. Miss it and the account sheet opens, the user picks an
 * account, and nothing comes back.
 *
 * The scheme is the iOS client id with its two halves reversed —
 * `123-abc.apps.googleusercontent.com` becomes
 * `com.googleusercontent.apps.123-abc` — so it is derived here rather than
 * written down twice and allowed to disagree with itself.
 *
 * It is registered only when `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is set — in
 * `apps/mobile/.env` for local work and as an EAS environment variable for
 * cloud builds, which have no `.env` to read. The conditional is load-bearing
 * rather than tidiness: the library's plugin *throws* on a missing or
 * malformed `iosUrlScheme`, so registering it unconditionally would turn a
 * fresh clone with no `.env` — which is every fresh clone, the file is
 * gitignored — into a config that cannot even be resolved, on Android too.
 *
 * **The variable is part of the update fingerprint.** `runtimeVersion.policy`
 * is `fingerprint`, and the fingerprint hashes this function's *output*, so
 * setting or clearing the variable moves the runtime version on both platforms
 * even though the plugin only ever touches `Info.plist`. `.env` and the EAS
 * environment therefore have to agree: a fingerprint computed on a laptop whose
 * `.env` disagrees with EAS will not match any build, and every update
 * published from it reaches nothing. See `docs/MOBILE_RELEASE.md` §3.3.
 */

/**
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`.
 *
 * Returns `null` for anything that is not a Google client id, including the
 * empty string, so the caller's check is a single truthiness test.
 */
function reversedClientId(clientId) {
  const suffix = ".apps.googleusercontent.com";

  if (!clientId || !clientId.endsWith(suffix)) {
    return null;
  }

  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

module.exports = ({ config }) => {
  const iosUrlScheme = reversedClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
    },
    plugins: iosUrlScheme
      ? [
          ...(config.plugins ?? []),
          ["@react-native-google-signin/google-signin", { iosUrlScheme }],
        ]
      : config.plugins,
  };
};
