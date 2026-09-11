# Handoff — ID card: blank PNG fix, camera capture, KYC step flow

Everything below is **uncommitted** in the working tree. Web and mobile both
typecheck; web 2621 tests and mobile 1412 tests pass.

Read `CLAUDE.md` first — it is binding. Note that two paths it names no longer
exist: `ui_inspiration_folder/app_recordings/NOTES.md` and
`ui_inspiration_folder/hostelhub_master_ui_screens/`. That folder now holds a
flat set of generated mockup PNGs. `docs/DESIGN.md` and
`apps/mobile/src/app/ui-preview.tsx` are still there and still apply.

---

## Done

### Part 1 — the emailed card PNGs had no text

**Cause confirmed.** The painter asks for `"Inter", "Segoe UI", system-ui, …`.
A Vercel lambda has no fonts at all, and `fillText` against a family it cannot
resolve draws nothing and throws nothing — so shapes rendered, every glyph
vanished, the renderer's own `catch` never fired, and a 40 KB picture of a
header curve and a dashed line was emailed. Windows has Segoe UI, which is why
every local render and the existing test looked right.

- Inter (OFL) added at `apps/web/src/lib/fonts/` — static 500/600/700/800 plus
  `OFL.txt`. **Not** in `public/`: `next.config.ts` excludes `./public/**` from
  every function trace, so a font there would never reach the lambda.
- `apps/web/src/lib/id-card-fonts.ts` registers the four faces under the family
  `Inter`, memoised per process, and returns `false` if the files are missing or
  the native font DB refuses them.
- `renderIdCardPng` calls it **first**, before anything is drawn, and returns
  `null` with `id_card_render_failed` rather than emailing a blank card.
  Ordering matters: `@napi-rs/canvas` caches the resolution of a font *string*,
  so anything measured before registration stays resolved to the host fallback
  for the life of the process.
- `setIdCardFontStack` narrows the server's stack to `"Inter"` with no fallback,
  so a future registration failure shows up in a test instead of in someone's
  inbox.
- `next.config.ts`: `ID_CARD_FONTS` added to the three card-issuing routes'
  `outputFileTracingIncludes`.
- Tests in `platform-id-card.server.test.ts`: a pixel test on the name band of a
  rendered front face, and an assertion that all four weights are registered.
  The weights are asserted rather than a measured width, because
  `@napi-rs/canvas` answers an unresolvable family with a host fallback — a
  width proves nothing on a dev machine.

Rendered locally and eyeballed: the back face draws its title, headings,
bullets, ID number, issue date and footer correctly.

**Still to do, and both need you:**
1. Verify on a deployed preview. Local Windows has fonts, so only a real
   deployment proves the trace include works. The card email fires only on a
   profile's **first** save. Use a minted JWT; never type a password.
2. Decide whether to resend cards to people who already received blank ones.
   `sendIdCardEmail` only fires on the first save, so they will never get
   another one by themselves.

### Part 2 — signature drawn *or* photographed; both captures are in-app

**Server**
- `UserResidentProfile` gains `signatureAssetId` + `signatureUpdatedAt`.
- `profile.signature` is now optional in the schema; the save envelope accepts
  `signatureAssetId`; sending both is refused. "There has to be a signature" is
  decided in `saveResidentIdentity` (`SIGNATURE_REQUIRED`, 422) because that is
  the only place that can see all three facts — strokes, asset, and what is
  already on the record. Drawing clears the stored image with `$unset`.
- `loadOwnedPhotoAsset` generalised to `loadOwnedImageAsset(owner, id, kind)`
  with per-kind error codes.
- `GET /api/v1/users/resident-identity/signature` streams the bytes through our
  own origin (same reason as the photo route: a cross-origin image taints the
  canvas). Never exposed to a hostel — `toResidentPrefill` builds its object
  field by field, so the signature cannot leak into a scan prefill.
- `getResidentIdentity` now returns `hasSignatureImage` and
  `signatureUpdatedAt`.
- The painter takes `signatureImage` and draws it `contain` into
  `SIGNATURE_BOX`; the email render loads the bytes alongside the photo and QR.

**Mobile**
- `components/guided-capture.tsx` — a full-screen camera with a dimmed-surround
  guide frame (oval for a face, 3:1 rounded rect for a signature), shutter,
  camera switch, and a Retake / Use this confirm shown on the *cropped* result.
- `lib/capture-crop.ts` + tests — maps the guide frame from preview coordinates
  onto the photograph, accounting for the centre crop `CameraView` applies.
  Cropping by naive percentage is off by a third of a frame on a 16:9 sensor
  behind a 4:3 preview.
- `expo-image-manipulator` was **already** a dependency, so no native
  fingerprint change and no new build is needed for this.
- `identity-api.ts`: `signatureAssetId` on save, `identitySignatureSource`.

### Part 3 — the mobile form is now a KYC step flow

- `lib/id-card.ts`: `IDENTITY_STEPS` (9 steps), `IDENTITY_STEP_FIELDS`,
  `validateIdentityStep`, `identityStepComplete`, `firstIncompleteIdentityStep`,
  and `signatureImageUri` on the draft. The rules are **not** duplicated per
  step — `validateIdentity` stays the single statement of what the server
  accepts and a step is a filter over its result. A test asserts every rule is
  owned by some step, so no error can become undisplayable.
- `app/id-card/edit.tsx` rewritten: one step per screen, `AppBar` showing
  "Step N of M" with the step's name, an animated `Meter` under it, slide+fade
  between steps (`FadeInRight`/`FadeInLeft`, `ReduceMotion.System`), Back and
  Continue in the footer, "Skip" on an untouched optional step, and a Review
  step of `FactRow` facts with a per-section Edit and a warning when a section
  is incomplete. Editing an existing card **opens on Review**. The first save
  still `router.replace("/id-card")`s and calls `revalidateSession()`.
- Photo and signature each upload on capture and ride along as handles.

---

## Not done

### 1. The web side of Parts 2 and 3 — the big one

`apps/web/src/components/resident-identity.tsx` (2182 lines) is untouched. It
needs:
- the same nine steps inside the existing modal, same order and same titles;
- camera via `getUserMedia` — front for the photo, rear for the signature —
  falling back to `<input capture>`; the crop maths in
  `apps/mobile/src/lib/capture-crop.ts` is pure and worth porting rather than
  re-deriving;
- the signature as draw (existing pad) **or** photograph, posting
  `signatureAssetId`;
- the card preview drawing a photographed signature through the new
  `/users/resident-identity/signature` endpoint.

The server for all of this is already built and tested; this is client work
only.

### 2. Verification

- Mobile: one `adb screencap` of the new steps beside the reference frames.
  **Ask before launching anything on the phone** — it is the user's daily
  handset. A Gradle debug APK needs `adb reverse tcp:8081 tcp:8081`.
- Web: a browser preview of the modal.
- Neither has been looked at in a browser or on a device.

### 3. Facility filters and amenities (the separate item)

Untouched, and independent of everything above:
- the facility section's search-bar filter should allow **multiple** selections;
- the amenity list needs the things a hostel actually has — personal cupboard
  (*daraz*), personal table, and the rest of the essentials;
- the same expanded list has to reach the team **register-hostel** form.

Start by finding the shared amenity/facility constant both the filter and the
registration form read, and widen that rather than the two call sites.
