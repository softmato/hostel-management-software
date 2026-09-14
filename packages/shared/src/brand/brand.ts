/**
 * The platform's name, once, for the web, the server, the emails and the app.
 *
 * No imports, so Metro can alias this file into the mobile bundle the same way
 * it does `calendar/`, `plans/`, `food/` and `night/`. The app's store identity —
 * the `hostelpalika://` scheme and `com.softmato.hostelpalika` — lives in
 * `apps/mobile/app.json`, not here. Internal identifiers that still contain the
 * old name — cookie and storage keys, the `x-hostelhub-client` header, native
 * module names — are not the brand: renaming them logs people out.
 */
export const PLATFORM_NAME = "HostelPalika";

/** The two-tone wordmark: head in ink, tail in brand green. */
export const PLATFORM_NAME_PARTS = { head: "Hostel", tail: "Palika" } as const;

export const PLATFORM_VENDOR = "Softmato";

export const POWERED_BY = `Powered by ${PLATFORM_VENDOR}`;
