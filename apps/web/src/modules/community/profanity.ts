/**
 * Deliberately small, deliberately dumb word filter.
 *
 * It masks a handful of obvious slurs and nothing else. It is a speed bump, not
 * moderation — the real control is the report → hide flow a hostel admin drives.
 * Treating this as a safety feature would be a mistake; anything it misses is
 * expected to be caught by a person.
 */
const BLOCKED = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "randi",
  "muji",
  "gadha",
];

const PATTERN = new RegExp(`\\b(${BLOCKED.join("|")})\\w*\\b`, "gi");

export function maskProfanity(text: string) {
  return text.replace(PATTERN, (match) => "*".repeat(match.length));
}

export function containsProfanity(text: string) {
  PATTERN.lastIndex = 0;

  return PATTERN.test(text);
}
