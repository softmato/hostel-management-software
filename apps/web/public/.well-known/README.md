# `/.well-known/assetlinks.json`

Android Digital Asset Links. Serving this file is what turns
`https://<site>/inquiry?ref=…` from "opens a browser tab" into "opens the app",
because Android verifies the statement at install time and only then grants the
app the right to claim the domain's links.

Static rather than a route handler on purpose: it is a constant per app, it must
answer fast and cacheably at install time, and a file is easier to correct in a
hurry than a deploy of server code. Next serves everything under `public/`
verbatim at the site root, dot-directories included.

## The fingerprint

`sha256_cert_fingerprints` lists the **signing** certificate, not the app. The
value committed here is the release keystore held at
`apps/mobile/credentials/android/keystore.jks`, read with:

```bash
keytool -list -v -keystore apps/mobile/credentials/android/keystore.jks -alias <alias>
```

Two things will make this list wrong, and both fail **silently** — links simply
keep opening the browser, with no error anywhere:

1. **EAS is signing with a different key.** The keystore above is local
   (`credentials.json` mode). If a build ever uses an EAS-managed keystore
   instead, its fingerprint has to be added. `eas credentials` shows it.
2. **Google Play App Signing is enabled.** Play then re-signs every release with
   *its own* key, and the fingerprint users actually run is the one on the Play
   Console's App Integrity page — not this one. Add it; do not replace, because
   internally distributed APKs are still signed with the upload key.

The array holds as many fingerprints as needed. Adding one is always safer than
swapping one.

## Verifying a change

```bash
curl -s https://hostel-management-software-web.vercel.app/.well-known/assetlinks.json
```

It must answer `200` with `Content-Type: application/json` and **no redirect** —
Android follows neither. Google's tester:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://hostel-management-software-web.vercel.app&relation=delegate_permission/common.handle_all_urls
```

After it passes, `intentFilters` in `apps/mobile/app.json` is the other half; one
without the other does nothing.

## If the site moves to a custom domain

Verification is per-origin. A new domain needs this same file served from it, and
a second `intentFilters` entry in `app.json` naming that host.
