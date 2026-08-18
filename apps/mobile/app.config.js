/**
 * A thin overlay on `app.json`, for the one field that cannot live there.
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
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
});
