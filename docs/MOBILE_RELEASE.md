# Mobile release & OTA runbook

How a build gets made, what an over-the-air update can and cannot change, and
the three things that work on a hand-installed APK and then silently stop
working once the app is distributed by a store.

Everything here is run from `apps/mobile`.

---

## 1. Before the first build

Two checks, both cheap, both expensive to skip.

### 1.1 Confirm EAS is signing with the keystore we already committed to

This is the single most important pre-flight check, because getting it wrong is
invisible: the build succeeds, the APK installs, and **Google sign-in and app
links are both dead** on it with nothing saying why.

Three separate things are pinned to one signing certificate:

| Pinned to it | Where |
|---|---|
| The Android OAuth client that lets the app talk to Google at all | Google Cloud project `567374505362` |
| The Digital Asset Links statement that makes `https://…` links open the app | `apps/web/public/.well-known/assetlinks.json` |
| Every future update Android will accept as an update to *this* app | Android itself |

The certificate they are pinned to is:

```
SHA-1    A8:D5:01:5D:75:7A:07:32:09:8C:C8:3D:0C:21:8C:46:9C:91:45:27
SHA-256  AA:45:1C:E1:DC:30:3E:BB:BC:D4:27:A1:AC:76:EE:05:BF:7F:A5:54:69:E6:B4:98:74:0E:78:7F:62:31:E8:E1
```

Check what EAS holds:

```bash
eas credentials --platform android
```

If EAS has no Android keystore it will offer to **generate** one, and a
generated keystore has a different fingerprint — which breaks all three rows
above at once. Upload the existing one instead; it is at
`apps/mobile/credentials/android/keystore.jks` with its passwords in
`apps/mobile/credentials.json` (both gitignored, both must be backed up
somewhere that is not this laptop — losing them means never being able to
update the app on Play again).

After the build, the EAS build log prints the fingerprint it signed with.
Compare it to the SHA-256 above before handing the APK to anyone.

### 1.2 Push notifications need the FCM key on EAS

`google-services.json` is already uploaded as the `GOOGLE_SERVICES_JSON` file
variable in all three environments, so the build has it. What it does **not**
cover is the server's permission to send: that is the Firebase service account,
and it is the thing that failed silently once already — Expo's tickets came back
`ok` and only the *receipts* carried the 403.

---

## 2. The builds

Four production profiles, split by **what the artefact is for**, not by
platform. All four share `channel: "production"`, so one update reaches every
one of them.

| Profile | Artefact | For |
|---|---|---|
| `production` | Android APK | Install on a phone and try it |
| `production-ios` | iOS ad-hoc IPA | Install on a registered iPhone and try it |
| `store-android` | AAB | Play Console submission |
| `store-ios` | IPA | App Store Connect submission |

### 2.1 Android APK — install and test

```bash
eas build --profile production --platform android
```

EAS prints an install URL and a QR code when it finishes. Open it on the phone
and install. Nothing else is needed; the APK is signed with the key from §1.1
and points at the deployed API.

### 2.2 iOS — install and test

Ad-hoc distribution names the exact devices it is allowed to install on, so the
iPhone has to be registered **before** the build. A build made first will not
install on a device registered afterwards; you would have to build again.

```bash
eas device:create
```

Pick the "website" method, open the link on the iPhone, install the profile it
offers, and the UDID registers itself. Then:

```bash
eas build --profile production-ios --platform ios
```

EAS will ask for the Apple ID on the first iOS build and create the
distribution certificate, provisioning profile and push key itself. It will also
add the **Associated Domains** capability, because `app.json` now declares one.

### 2.3 Store artefacts — only when the tested build is good

```bash
eas build --profile store-android --platform android    # AAB for Play
eas build --profile store-ios --platform ios            # IPA for App Store
```

Submit with `eas submit --profile production --platform android` (uploads to the
Play *internal* track as a draft, per `eas.json`) or `--platform ios`.

---

## 3. OTA updates

### 3.1 What it is

`eas update` publishes the **JavaScript bundle and its assets** to a channel.
Apps built against that channel download it and run it instead of the bundle
they shipped with. No store review, no reinstall, no version bump.

```bash
eas update --channel production --message "Fix the totals on the statement screen"
```

Channels are already created and each is bound 1:1 to a branch of the same name:
`production`, `preview`, `development`.

### 3.2 When the user actually sees it

Not immediately, and this trips everyone up once.

The app is configured with `fallbackToCacheTimeout: 0`, which means it **launches
from the bundle it already has** and downloads the new one in the background.
The new bundle runs on the **next cold start**. So:

- Open the app → still the old version, update downloading
- Fully close it and open it again → new version

That is deliberate. The alternative is holding the splash screen while the phone
downloads a bundle over a Nepali mobile connection, which is the one thing the
app's boot path is written to avoid.

### 3.3 What an update can and cannot change

This is the rule that matters, and it is enforced by `runtimeVersion`. An update
only reaches builds whose runtime version matches the one it was published
against.

The policy is **`fingerprint`**: the runtime version is a hash computed from the
project's actual native dependency graph. It moves by itself whenever the native
side changes.

| Change | Reaches existing builds by OTA? |
|---|---|
| Screens, layout, copy, colours, logic, API calls | **Yes** |
| Images, fonts, other bundled assets | **Yes** |
| Adding or upgrading a native package (`expo-*`, anything with native code) | No — new build |
| Adding or changing an `app.json` plugin | No — new build |
| Permissions, app icon, splash, bundle id, deep-link filters | No — new build |
| Expo SDK upgrade | No — new build |

**Nothing bad happens when you get this wrong** — and that is precisely the
problem. Publishing an update whose fingerprint no longer matches any build does
not error; it publishes to a runtime version nobody is running, and reaches
zero phones. Check before you publish:

```bash
npx expo-updates fingerprint:generate --platform android | npx json hash
```

Or without a JSON tool — the command prints one large object and the field
wanted is `hash`:

```bash
npx expo-updates fingerprint:generate --platform android
```

Compare it to the fingerprint on the build in the EAS dashboard. If they differ,
the change needs a new binary, not an update.

One non-obvious input: **`google-services.json` is part of the fingerprint.**
The local copy and the one EAS writes from the `GOOGLE_SERVICES_JSON` file
variable have to be byte-identical, or a fingerprint computed on this laptop
will never match a build made in the cloud, and every update published from here
will reach nothing. If the file is ever regenerated in the Firebase console,
re-upload it:

```bash
eas env:create --name GOOGLE_SERVICES_JSON --type file \
  --value ./google-services.json --visibility secret \
  --environment development --environment preview --environment production --force
```

The `fingerprint` policy was chosen over `appVersion` for exactly this: with
`appVersion`, the runtime version only moves when someone remembers to bump it,
and forgetting means an OTA carrying JS that calls a native module the installed
binary does not contain — which is not a silent miss, it is a crash on a user's
phone. This app has a local native module (`modules/hostelhub-downloads`), so
that is not hypothetical.

### 3.4 Rolling one back

```bash
eas update:rollback --channel production
```

Which is another reason updates apply on the next launch rather than mid-session:
a bad update is one relaunch away from being gone, not a store review away.

---

## 4. What breaks after the store submission

Three things work perfectly on the APK you install by hand and then stop working
for anyone who installs from Play or the App Store. All three are fixed in a
console, not in code — no rebuild, no resubmission, no OTA.

### 4.1 Google sign-in, on Play installs only

Uploading an AAB does not ship our signature. **Play App Signing** strips the
upload key, re-signs with a key Google generates, and the app on a user's phone
carries a fingerprint that exists nowhere in this project. Google matches
`com.softmato.hostelhub` + signing SHA-1 against the OAuth client — so sign-in
fails for every Play install while working on every APK handed out directly,
which is what makes it expensive to find.

**Fix:** Play Console → Test and release → Setup → App signing → *App signing key
certificate*. Add that SHA-1 as **another** Android OAuth client in Google Cloud
project `567374505362`. Keep the existing one — APKs distributed outside Play
still carry it.

### 4.2 App links, on Play installs only

The same fingerprint, the same cause. `assetlinks.json` lists the certificate
Android verifies the domain claim against, and the Play-signed one is not in it.
Links quietly go back to opening a browser tab.

**Fix:** add the Play App Signing SHA-256 to the array in
`apps/web/public/.well-known/assetlinks.json` and deploy. **Add, do not
replace** — the array holds as many as needed and directly-installed APKs still
carry the original.

### 4.3 Universal links on iOS have never worked yet

Android's half is committed; iOS's is not, because the file has to name an Apple
Team ID that did not exist when it was written. `ios.associatedDomains` is
already declared in `app.json`, and the server route is already written.

**Fix:** set `APPLE_APP_ID_PREFIX` on the Vercel deployment to
`<Apple Team ID>.com.softmato.hostelhub` (Apple Developer → Membership) and
redeploy. `/.well-known/apple-app-site-association` answers 404 until then, which
is why nothing is broken today — iOS simply never claims the domain.

---

## 5. Still needed for the iOS build to be fully functional

The build itself will succeed without these. These are features that will be
missing or dead inside it.

| What | Why | Where |
|---|---|---|
| An **iOS OAuth client** | Google sign-in needs its own client id on iOS, plus the URL scheme derived from it. Until it exists the button is hidden rather than broken — `app.config.js` registers the plugin and `google-auth.ts` shows the button the moment `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is set in `apps/mobile/.env` **and** on EAS. | Google Cloud project `567374505362` |
| `APPLE_APP_ID_PREFIX` | Universal links — see §4.3. | Vercel env |
| An **APNs key** | Push. EAS offers to create it during the first iOS build; accept. | EAS prompt |

To add the iOS client id to EAS once it exists:

```bash
eas env:create --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID \
  --value <the id> --type string --visibility plaintext \
  --environment development --environment preview --environment production
```

---

## 6. A native rebuild loses nothing

Worth stating plainly, because it is the usual worry with a prebuild workflow:
`android/` and `ios/` are **generated**, gitignored, and regenerated from
`app.json` + `app.config.js` + the installed plugins on every EAS build.

This was verified rather than assumed — `expo prebuild --clean` was run against
the existing `android/` and the resulting `AndroidManifest.xml`,
`app/build.gradle`, `gradle.properties` and `settings.gradle` came back
identical. There is no hand-written native code in this project outside
`modules/hostelhub-downloads`, which is a proper local Expo module and is
autolinked like any other.

So: never edit anything under `android/` or `ios/`. A change made there survives
until the next prebuild and then vanishes, most likely in a cloud build where
nobody is watching. Put it in a config plugin instead — `app.config.js` is
already one.
