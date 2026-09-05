# hostelhub-downloads

A local Expo module with one job: **put a file somewhere the phone shows the
user, without asking the user anything.**

Documents go to `Download/HostelHub/`. Images go to `Pictures/HostelHub/`, which
is a different MediaStore collection and not a detail: a row in **Downloads** is
a download, so a gallery neither lists it nor reliably opens it, while a row in
**Images** appears beside the camera roll and answers an `ACTION_VIEW`. A saved
ID card that a tap on its own notification would not open is what that
distinction costs when it is ignored.

## Why it exists

Every no-native-code route to a user-visible Downloads folder on modern Android
costs a prompt:

| route | prompt | visible to the user | notes |
|---|---|---|---|
| `WRITE_EXTERNAL_STORAGE` | runtime dialog | yes | dead from API 33; already `maxSdkVersion="32"` in our manifest |
| `MANAGE_EXTERNAL_STORAGE` | full-screen settings trip | yes | Play rejects it for apps that are not file managers |
| Storage Access Framework | folder picker, once | yes | what `lib/documents.ts` falls back to |
| app-specific external dir | none | **no** — Android 11+ hides `Android/data` from file managers | also wiped on uninstall |

`MediaStore.Downloads` is the fifth route and the only one with none of those
costs: since API 29 an app may insert into the Downloads collection, including
into a subfolder of its own via `RELATIVE_PATH`, with **no permission at all**.
It is what Chrome and WhatsApp do. There is no Expo module that exposes it for
arbitrary files — `expo-media-library` handles images, video and audio only — so
this is that module.

## What it does not handle

- **API < 29.** `RELATIVE_PATH` and the Downloads collection both arrive in 29;
  below that the only public-folder write needs `WRITE_EXTERNAL_STORAGE` and a
  runtime dialog. `saveToDownloads` reports `unsupported` and the JS side falls
  back to the SAF grant, which works down to API 21.
- **iOS.** There is no user-browsable filesystem to write into; a "download"
  there is the share sheet into Files. The module is Android-only by
  `expo-module.config.json`, and `requireOptionalNativeModule` returns `null`
  everywhere else.
- **Any build made before this module existed.** Same `null`, same fallback —
  which is why the JS never imports from this folder directly and nothing breaks
  until the binary catches up.

## Where it is used

Never directly. `src/lib/native-downloads.ts` wraps it and `downloadToDevice` in
`src/lib/documents.ts` is the only caller — see the ladder documented there.
