import { randomBytes } from "node:crypto";

/**
 * How a cook login is spelled, and what a removed cook's past work is called.
 *
 * Pure functions with no database of their own — the one call that needs to
 * check uniqueness takes an `isTaken` probe — so the rules here are testable
 * without a Mongo connection.
 */

/**
 * The domain generated cook logins live on.
 *
 * Deliberately not a routable mailbox and deliberately **short**. The previous
 * scheme was `cook@<hostel-slug>.hostelhub.local`, which for a real hostel came
 * out as `cook@sunrise-boys-hostel-kathmandu.hostelhub.local` — 49 characters
 * of address to type on a kitchen phone, on a login screen, with wet hands.
 *
 * `cook.local` keeps the "this is a login, not an inbox" signal the old suffix
 * carried while giving the whole address room to fit in one glance.
 */
export const COOK_LOGIN_DOMAIN = "cook.local";

/**
 * Password alphabet with every look-alike removed — no `O`/`0`, no `l`/`1`/`I`,
 * no `5`/`S`. These passwords get read off a screen, written on a whiteboard,
 * and typed by someone who is not the person who received them, so a character
 * that can be misread is a support call.
 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrtuvwxyz23467989ACDEFGHJKMNPQRTUVWXYZ";

/** Same reasoning, minus the uppercase: an email address is lowercase anyway. */
const LOGIN_ALPHABET = "abcdefghjkmnpqrtuvwxyz23467989";

function pick(alphabet: string, length: number) {
  // `randomBytes` rather than `Math.random`: this is a credential.
  const bytes = randomBytes(length);
  let out = "";

  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }

  return out;
}

/**
 * The first-time password handed to a cook.
 *
 * Eight characters from an unambiguous alphabet rather than the twelve
 * base64url characters the rest of the product issues. A cook password is
 * spoken across a kitchen; `-` and `_` and case-sensitive look-alikes are not
 * things that survive that trip, and the account can do exactly two things
 * (announce a meal, post a photo) behind a per-hostel scope.
 */
export function generateCookPassword() {
  return pick(PASSWORD_ALPHABET, 8);
}

/**
 * The stem of a generated login: up to four letters taken from the hostel's own
 * name or slug, so the address is recognisable as *this* hostel's rather than
 * an anonymous string. Falls back to `ck` when the name has nothing usable in
 * it (a hostel named only in Devanagari, for instance).
 */
export function cookLoginStem(hostelNameOrSlug: string) {
  const letters = hostelNameOrSlug.toLowerCase().replace(/[^a-z]/g, "");

  return letters.slice(0, 4) || "ck";
}

/**
 * Mints a short, unique login for a generated cook account.
 *
 * `isTaken` is asked about each candidate, because uniqueness is a property of
 * the database, not of the string. Collisions on a four-character suffix are
 * rare but not impossible, so it retries; after `attempts` tries it widens the
 * suffix rather than failing, which cannot collide forever.
 *
 * @example `sunr@cook.local`, then `sunr7k@cook.local` once that is taken.
 */
export async function mintCookLogin(
  hostelNameOrSlug: string,
  isTaken: (email: string) => Promise<boolean>,
  attempts = 6,
) {
  const stem = cookLoginStem(hostelNameOrSlug);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // The first cook of a hostel gets the bare stem — `sunr@cook.local` — and
    // only a second one pays for a suffix. Most hostels have one cook.
    const suffix = attempt === 0 ? "" : pick(LOGIN_ALPHABET, 2);
    const candidate = `${stem}${suffix}@${COOK_LOGIN_DOMAIN}`;

    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  // Widened rather than abandoned: six taken candidates means this hostel has a
  // lot of retired cooks, not that it can never have another one.
  const candidate = `${stem}${pick(LOGIN_ALPHABET, 5)}@${COOK_LOGIN_DOMAIN}`;

  if (await isTaken(candidate)) {
    throw new Error("Could not mint a unique cook login.");
  }

  return candidate;
}

/**
 * What a removed cook's past work is shown under: `Previous Sunrise cook`.
 *
 * The hostel's **first word**, not its full name — "Previous Sunrise Boys
 * Hostel Pvt. Ltd. cook" is a label nobody reads. The first word is how the
 * place is spoken about anyway, and the row it labels is already inside that
 * hostel's own screens, so there is nothing to disambiguate against.
 *
 * Frozen into `CookAccount.historicalName` at removal — see the model — so a
 * later rename does not rewrite history.
 */
export function previousCookLabel(hostelName: string) {
  const firstWord = hostelName.trim().split(/\s+/)[0] ?? "";

  return firstWord ? `Previous ${firstWord} cook` : "Previous cook";
}
