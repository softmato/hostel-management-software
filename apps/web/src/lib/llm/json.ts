/**
 * Small free models routinely wrap JSON in prose or markdown fences and emit
 * raw control characters inside strings. These helpers pull the payload out and
 * repair it before parsing, so one sloppy response does not cost a retry.
 */

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** Strip markdown fences and any prose surrounding the JSON value. */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  // Prefer whichever of `{...}` / `[...]` starts first, so an object containing
  // an array is not mistaken for a bare array.
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const useArray = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");

  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

/** Normalize smart quotes and escape control characters left inside strings. */
export function sanitizeJsonPayload(raw: string): string {
  const normalized = raw.replace(/“|”/g, '"').replace(/‘|’/g, "'");

  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const code = normalized.charCodeAt(index);

    if (!inString) {
      if (char === '"') {
        inString = true;
        result += char;
        continue;
      }
      if (code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t") {
        continue;
      }
      result += char;
      continue;
    }

    if (escaping) {
      if (VALID_JSON_ESCAPES.has(char)) {
        result += char;
      } else if (char === "\n") {
        result += "n";
      } else if (char === "\r") {
        result += "r";
      } else if (char === "\t") {
        result += "t";
      } else {
        result += `\\${char}`;
      }
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += "\\";
      escaping = true;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = false;
      continue;
    }
    if (char === "\n") {
      result += "\\n";
      continue;
    }
    if (char === "\r") {
      result += "\\r";
      continue;
    }
    if (char === "\t") {
      result += "\\t";
      continue;
    }
    if (code < 0x20) {
      result += " ";
      continue;
    }

    result += char;
  }

  return result;
}

/** Parse a model response into T, or null if it is unsalvageable. */
export function parseModelJson<T>(raw: string, label: string): T | null {
  const extracted = extractJsonPayload(raw);
  if (!extracted) {
    return null;
  }

  try {
    return JSON.parse(extracted) as T;
  } catch {
    try {
      return JSON.parse(sanitizeJsonPayload(extracted)) as T;
    } catch (error) {
      console.error(`[${label}] Could not parse model JSON`, error);
      return null;
    }
  }
}
