/**
 * The platform's name, once, for the web, the server, the emails and the app.
 *
 * No imports, so Metro can alias this file into the mobile bundle the same way
 * it does `calendar/`, `plans/`, `food/` and `night/`. Identifiers that merely
 * *contain* the old name — the `hostelhub://` scheme, the Android package,
 * cookie and storage keys, native module names — are not the brand and do not
 * read from here: renaming them logs people out or orphans installed apps.
 */
export const PLATFORM_NAME = "HostelPalika";

/** The two-tone wordmark: head in ink, tail in brand green. */
export const PLATFORM_NAME_PARTS = { head: "Hostel", tail: "Palika" } as const;

export const PLATFORM_VENDOR = "Softmato";

export const POWERED_BY = `Powered by ${PLATFORM_VENDOR}`;
