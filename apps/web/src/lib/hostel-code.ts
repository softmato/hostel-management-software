/**
 * The Hostel ID an owner types at the plan checkout: `HH-3F9A1C2E`.
 *
 * Derived from the hostel's id rather than stored, so every hostel has one
 * with no migration. It is not a secret and not the only check — the checkout
 * also needs the hostel's email and a code sent to it — it only has to be
 * something the owner can read off their billing page and type back.
 *
 * Same string the app prints on its Home card (`hostelCode` in
 * `apps/mobile/src/lib/admin-home.ts`) — keep the two identical.
 */
export function hostelCode(id: string) {
  return `HH-${id.slice(-8).toUpperCase()}`;
}

/** `hh 3f9a 1c2e`, `HH3F9A1C2E` and `HH-3F9A-1C2E` all read as `HH-3F9A1C2E`. */
export function normalizeHostelCode(input: string) {
  // "H" is not a hex digit, so stripping non-hex drops the prefix too.
  const bare = input.toUpperCase().replace(/[^0-9A-F]/g, "");

  return bare.length === 8 ? `HH-${bare}` : "";
}
