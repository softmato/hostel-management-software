/**
 * The pure half of `components/ui/avatar.tsx`.
 *
 * Split out for the same reason `lib/status.ts` is: Vitest runs node-side with
 * no React Native shim, so anything importing `react-native` cannot be tested —
 * and the initial and the tone are exactly the parts worth testing. A name that
 * starts with a space, an emoji, or nothing at all all reach this.
 */

/**
 * One letter, matching the web (`community-post-card.tsx`).
 *
 * Deliberately not two: Nepali names in this product are stored as one free
 * `name` field, so "Ram Bahadur Shrestha" and "ram" both arrive, and initials
 * taken from word boundaries give `RBS` for one and `R` for the other. One
 * letter is the same size on every row, and the same letter the web shows for
 * the same person.
 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";

  if (!trimmed) {
    return "?";
  }

  // `toUpperCase` before the charAt: Turkish-style casing aside, an accented
  // lowercase first letter should still render as its capital.
  const first = trimmed.toUpperCase().charAt(0);

  // Digits and punctuation are legitimate first characters of a hostel name
  // ("7 Hills"); an empty string never is.
  return first || "?";
}

/**
 * A stable index into whatever tone table the component holds.
 *
 * The same hash the web uses, so one account is the same colour in both
 * clients. It must be deterministic across launches — a colour that changes on
 * every render stops being a way to recognise anyone.
 */
export function avatarToneIndex(name: string | null | undefined, buckets: number): number {
  if (buckets <= 0) {
    return 0;
  }

  const source = name?.trim() ?? "";
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    // `>>> 0` keeps it an unsigned 32-bit int, so it never goes negative and
    // the modulo below cannot return a negative index.
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash % buckets;
}
