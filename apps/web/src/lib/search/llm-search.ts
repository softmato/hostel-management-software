import { parseModelJson } from "@/lib/llm/json";
import { llmGenerate } from "@/lib/llm/providers";

import {
  AREAS,
  CITIES,
  FACILITIES,
  ROOM_TYPES,
  type SearchFilters,
} from "./query-parser";

const PLACES = [...AREAS, ...CITIES];

const SYSTEM_PROMPT = [
  "You convert a hostel seeker's search sentence into structured filters for a",
  "Nepal hostel listing site. Respond with valid JSON only.",
].join(" ");

/**
 * Ask a model to structure a query the keyword pass could not explain. Returns
 * null whenever the model is unavailable or its answer is unusable, so the
 * caller can fall back to plain text search.
 */
export async function parseWithLLM(query: string): Promise<SearchFilters | null> {
  const prompt = [
    `Search sentence: "${query}"`,
    "",
    "Return one JSON object with only the keys you are confident about:",
    '{ "area": string, "type": "BOYS"|"GIRLS"|"CO_LIVING", "minPrice": number,',
    '  "maxPrice": number, "food": "veg"|"non-veg", "facility": string,',
    '  "roomType": string, "q": string }',
    "",
    "Rules:",
    "- Omit every key you cannot infer. An empty object {} is a valid answer.",
    "- Never invent a value. Only use what the sentence actually says.",
    "- Prices are NPR per month; '8k' means 8000. If no budget is stated, omit",
    "  BOTH minPrice and maxPrice. Never set them to the same number.",
    `- area must be exactly one of: ${PLACES.join(", ")}`,
    `- facility must be exactly one of: ${FACILITIES.join(", ")}`,
    `- roomType must be exactly one of: ${ROOM_TYPES.join(", ")}`,
    "- q is only for a hostel or college NAME, max 60 characters. Never put the",
    "  whole sentence in q.",
    "- Do not add keys outside the list above.",
  ].join("\n");

  const raw = await llmGenerate(prompt, {
    json: true,
    maxTokens: 300,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.1,
  });

  if (!raw.trim()) {
    return null;
  }

  const payload = parseModelJson<Record<string, unknown>>(raw, "parseWithLLM");
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return normalizeFilters(payload, query);
}

/**
 * Whitelist and coerce the model's output. Anything unexpected is dropped
 * rather than trusted — this feeds a database query, and the free 8B models
 * behind this router confidently invent values ("roomType": "quiet") no matter
 * what the prompt says. Enum-ish fields are snapped to the same vocabularies
 * the keyword parser uses, so a hallucinated value becomes an omitted filter
 * instead of a query that matches nothing.
 */
function normalizeFilters(
  payload: Record<string, unknown>,
  query: string,
): SearchFilters | null {
  const filters: SearchFilters = {};

  // Letters and digits only, so "wi-fi" in the query still matches "WiFi".
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const squashedQuery = squash(query);

  /**
   * Match against a closed vocabulary, and additionally require the query to
   * actually mention it. Without the mention check these models attach
   * plausible-looking filters ("Attached bathroom", "Single") to sentences that
   * never asked for them, quietly hiding most of the results.
   */
  const oneOf = (value: unknown, allowed: string[]): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const needle = value.trim().toLowerCase();
    const match = allowed.find((item) => item.toLowerCase() === needle);
    if (!match) {
      return undefined;
    }

    // Any meaningful word of the matched value must appear in the query.
    const mentioned = match
      .split(/\s+/)
      .map(squash)
      .filter((word) => word.length >= 3)
      .some((word) => squashedQuery.includes(word));

    return mentioned ? match : undefined;
  };

  const price = (value: unknown): number | undefined => {
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000
      ? Math.round(amount)
      : undefined;
  };

  filters.area = oneOf(payload.area, PLACES);
  filters.facility = oneOf(payload.facility, FACILITIES);
  filters.roomType = oneOf(payload.roomType, ROOM_TYPES);
  filters.minPrice = price(payload.minPrice);
  filters.maxPrice = price(payload.maxPrice);

  // `q` searches hostel names and areas, so it is only useful as a short
  // proper noun. Echoing the sentence back would match nothing.
  if (typeof payload.q === "string") {
    const candidate = payload.q.trim();
    if (
      candidate.length > 0 &&
      candidate.length <= 60 &&
      candidate.toLowerCase() !== query.trim().toLowerCase()
    ) {
      filters.q = candidate;
    }
  }

  if (
    payload.type === "BOYS" ||
    payload.type === "GIRLS" ||
    payload.type === "CO_LIVING"
  ) {
    filters.type = payload.type;
  }
  if (payload.food === "veg" || payload.food === "non-veg") {
    filters.food = payload.food;
  }

  // A budget the sentence never mentioned is the most common hallucination and
  // the most damaging, because it silently hides affordable results. Require
  // the query to contain a digit before trusting any price at all.
  if (!/\d/.test(query)) {
    delete filters.minPrice;
    delete filters.maxPrice;
  }

  // min === max is not a range a person means; and a reversed range means the
  // model misread the sentence. Either way, drop both bounds.
  if (
    filters.minPrice !== undefined &&
    filters.maxPrice !== undefined &&
    filters.minPrice >= filters.maxPrice
  ) {
    delete filters.minPrice;
    delete filters.maxPrice;
  }

  const hasAnything = Object.values(filters).some((value) => value !== undefined);

  return hasAnything ? filters : null;
}
