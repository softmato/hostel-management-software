# Brand assets — ALL PLACEHOLDERS

Every PNG in this folder is generated, not designed: a green (`#0a8a4b`) rounded
square with a white "H". They exist so the app builds and the splash screen is not
blank. **Replace them when the real logo arrives.**

| File | Used for | Required size |
|---|---|---|
| `icon.png` | iOS app icon, Expo fallback | 1024×1024, opaque, no alpha |
| `android-icon-foreground.png` | Android adaptive icon, top layer | 1024×1024, transparent, art inside the middle ~66% |
| `android-icon-background.png` | Android adaptive icon, bottom layer | 1024×1024, opaque |
| `android-icon-monochrome.png` | Android themed icons **and the notification tray icon** | 1024×1024, white on transparent, silhouette only |
| `splash-icon.png` | Native splash mark | 512×512, transparent, white art (it sits on brand green) |
| `logo-mark.png` | In-app logo on light surfaces | 512×512, transparent, green art |
| `logo-mark-light.png` | In-app logo on the JS splash + dark surfaces | 512×512, transparent, white art |
| `favicon.png` | Web build tab icon | 96×96 |

Swapping the files is the whole job — no code references a colour or a shape,
only these paths (via `src/constants/branding.ts`).

Two things to watch when the real art lands:

- **`android-icon-monochrome.png` must be a flat white silhouette on transparent.**
  Android tints it; anything with its own colours renders as a grey blob in the
  status bar.
- **`icon.png` must not have an alpha channel.** iOS rejects icons with
  transparency at submission time.

Regenerate the current placeholders with the script noted in the commit that
added them, or just overwrite the files.
