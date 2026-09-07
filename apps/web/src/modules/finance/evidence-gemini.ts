import type {
  EvidenceReadFailure,
  OcrResult,
} from "@/modules/finance/evidence-engine";

/**
 * Reading a receipt with Gemini, as the engine that works without a card.
 *
 * `evidence-vision.ts` is the better instrument and it stays. But Cloud Vision
 * bills, and billing needs a payment card on the Google Cloud account —
 * required even to stay inside the free tier. That card does not exist yet, so
 * Vision has never once run, and meanwhile Tesseract cannot run in the Vercel
 * lambda at all. Between them the pipeline reads nothing in production.
 *
 * Gemini's API is a different product from Cloud Vision with different terms:
 * an AI Studio key, a free tier, **no card**. The model is multimodal, so a
 * receipt image goes in and its text comes out. The key already exists in this
 * repo — `GEMINI_API_KEYS`, the same one `lib/llm` uses — so there is nothing to
 * procure and nothing to approve.
 *
 * ## Non-negotiables
 *
 * - **This model transcribes. It never decides.** The prompt asks for the text
 *   on the page and nothing else; every judgement about what that text means —
 *   the payee, the amount, the direction, whether the claim matches — stays in
 *   `evidence-receipt.ts` and its neighbours, which are deterministic and
 *   testable. This is not fastidiousness. A resident chooses the image, and an
 *   image can carry words aimed at a language model; the moment the model is
 *   asked to *judge* rather than *transcribe*, a sentence painted onto a
 *   screenshot becomes an instruction to approve a claim. Transcribing keeps
 *   that attack no stronger than printing the same lie on the receipt, which
 *   every engine has always been equally fooled by and which the parsers were
 *   written to weigh.
 * - **Temperature zero, and no hidden reasoning.** `thinkingBudget: 0` is worth
 *   about two seconds a read and costs nothing here: transcription is not a
 *   task that benefits from deliberation.
 * - **Failure is `null`, never a fallback.** Same rule as Vision, same reason:
 *   a degraded read that happens to match a claim is a false confirmation, and
 *   that is worse than no signal.
 * - **No SDK.** Plain `fetch`, for the reason the whole migration exists — a
 *   module with no runtime files is a module a bundler cannot break.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The models to try, in order, until one answers.
 *
 * **The free tier is metered per model per day, and the limits are small** —
 * `gemini-2.5-flash` allows twenty requests a day, which a hostel taking rent
 * would exhaust before lunch. Walking a list is what turns several small
 * allowances into one usable one, and it is the same shape `lib/llm/providers.ts`
 * already uses for the same reason.
 *
 * `gemini-3.1-flash-lite` leads because it is measurably the best fit here, not
 * because it is cheapest: on the corpus it answers in about three seconds
 * against `gemini-2.5-flash`'s seven, and returns the same transcription with
 * each label and its value on one line — which is the shape the parsers need.
 * The heavier model is last precisely because its allowance is the one that runs
 * out first.
 */
/*
 * Only names verified against this corpus belong here. `gemini-3.5-flash-lite`
 * was in this list and answered HTTP 400 to every request — Google gates some
 * newer models behind a different API — which cost a round trip per read and,
 * on the one file where the first model was already spent, cost the read
 * entirely. A model that has not been seen to work is not a fallback.
 */
const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];

function models(): string[] {
  const configured = (process.env.EVIDENCE_GEMINI_MODEL ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_MODELS;
}

/**
 * How long one read may take.
 *
 * Longer than Vision's six seconds because this is a language model rather than
 * a document endpoint, and because the budget has to cover falling through to a
 * second model when the first one's daily allowance is spent. A single
 * `gemini-3.1-flash-lite` read of this corpus lands near three seconds. A
 * resident is watching an upload, so this is the ceiling rather than the target,
 * and a read that misses it is reported as a timeout rather than retried.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Free tier is generous but finite. The cap bounds a bug, not a budget. */
const DEFAULT_MONTHLY_CAP = 5_000;

/**
 * Transcription, stated three ways so the model does not summarise.
 *
 * The failure mode worth prompting against is not a misread character — it is a
 * helpful assistant returning "This is a payment receipt for NPR 70 to Tea Time
 * Anytime Cafeteria", which reads perfectly and destroys every label the parsers
 * key on.
 */
const PROMPT = [
  "Transcribe every line of text visible in this payment receipt image, exactly as printed.",
  "Keep each label together with its value on the same line, in the order they appear on the page.",
  "Do not summarise, translate, reformat, correct, or explain anything. Output the transcription as plain text and nothing else.",
].join(" ");

/** The keys, in the order they will be tried. Shared with `lib/llm`. */
function keys(): string[] {
  return (process.env.GEMINI_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Exported so callers can tell "switched off" from "tried and failed". */
export function isGeminiConfigured(): boolean {
  return keys().length > 0;
}

/** The vendor's billing month, which is Gregorian and UTC. */
function billingPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Counts this call and says whether it was inside the cap.
 *
 * Counted before the call for the same reason as Vision: the failure this
 * guards against is a retry loop, and a loop that only counts its successes
 * never trips the breaker. A counter that cannot be written does not stop the
 * read — switching off receipt reading platform-wide because Mongo hiccupped
 * would be a worse bug than the one being guarded against.
 */
async function withinMonthlyCap(): Promise<boolean> {
  const cap = Number(
    process.env.EVIDENCE_GEMINI_MONTHLY_CAP ?? DEFAULT_MONTHLY_CAP,
  );

  if (!Number.isFinite(cap) || cap <= 0) return true;

  try {
    // Lazy, so a run with the cap switched off never loads mongoose — which is
    // CommonJS, and cannot be named-imported from a plain ESM script like the
    // scoring harness.
    const { ApiUsageCounterModel } = await import(
      "@hostel/db/models/ApiUsageCounter"
    );
    const counter = await ApiUsageCounterModel.findOneAndUpdate(
      { period: billingPeriod(), service: "GEMINI_OCR" },
      { $inc: { count: 1 } },
      { new: true, upsert: true },
    ).lean<{ count?: number } | null>();

    if ((counter?.count ?? 0) > cap) {
      console.error(
        `[evidence-gemini] monthly cap reached: ${counter?.count ?? 0} calls against a cap of ${cap} for ${billingPeriod()} — receipts are no longer being machine-read`,
      );

      return false;
    }

    return true;
  } catch {
    return true;
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

export type GeminiRead =
  | { failure: EvidenceReadFailure; result: null }
  | { failure: null; result: NonNullable<OcrResult> };

/**
 * Reads the image, or explains why it did not.
 *
 * Walks the model list, and every configured key within each model, until one
 * answers. Nothing is retried after a 429: a spent allowance does not refill
 * inside a resident's upload, so the only useful move is the next model.
 */
export async function readWithGemini(
  prepared: Buffer,
  mimeType = "image/png",
): Promise<GeminiRead> {
  const available = keys();

  if (available.length === 0) return { failure: "not-configured", result: null };

  if (!(await withinMonthlyCap())) {
    return { failure: "over-budget", result: null };
  }

  const budget = Number(
    process.env.EVIDENCE_GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_TIMEOUT_MS,
  );
  const startedAt = Date.now();

  try {
    let lastFailure: EvidenceReadFailure = "provider-error";

    /*
     * Model first, key second.
     *
     * The daily allowance is per model per project, so an exhausted quota is far
     * more often the model's than the key's — and moving to the next model is
     * the move that actually gets the receipt read. Trying every key against a
     * spent model first would collect the same 429 once per key while the
     * resident waits.
     */
    for (const model of models()) {
      for (const key of available) {
        const outcome = await attempt(model, key, prepared, mimeType, controller);

        if (outcome.kind === "timeout") return { failure: "timeout", result: null };
        if (outcome.kind === "empty") return { failure: "empty", result: null };

        if (outcome.kind === "read") {
          return {
            failure: null,
            result: {
              engine: "gemini",
              ms: Date.now() - startedAt,
              text: outcome.text,
              /*
               * No boxes.
               *
               * The model is asked for a transcription, not for geometry, and a
               * language model's guess at pixel coordinates would be fiction
               * that looks like data. The contract allows `[]`, and the spatial
               * parsing of phase 3 waits for an engine that genuinely measures.
               */
              words: [],
            },
          };
        }

        lastFailure = outcome.failure;
      }
    }

    return { failure: lastFailure, result: null };
  } catch {
    if (controller.signal.aborted) return { failure: "timeout", result: null };

    return { failure: "unknown", result: null };
  } finally {
    clearTimeout(timer);
  }
}

type Attempt =
  | { failure: EvidenceReadFailure; kind: "failed" }
  | { kind: "empty" }
  | { kind: "read"; text: string }
  | { kind: "timeout" };

/** One model, one key, one request. */
async function attempt(
  model: string,
  key: string,
  prepared: Buffer,
  mimeType: string,
  controller: AbortController,
): Promise<Attempt> {
  let response: Response;

  try {
    response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  data: prepared.toString("base64"),
                  mime_type: mimeType,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) return { kind: "timeout" };

    return { failure: "unknown", kind: "failed" };
  }

  /*
   * 429 is a spent allowance, not a broken request, so it is worth moving on
   * from quietly. 404 is a model this project cannot reach — Google retires
   * these on its own schedule and closes older ones to new projects, so a name
   * in the list going stale is expected rather than alarming.
   */
  if (response.status === 429) return { failure: "over-budget", kind: "failed" };

  if (!response.ok) {
    if (response.status !== 404) {
      console.error(
        `[evidence-gemini] ${model}: HTTP ${response.status} ${response.statusText}`,
      );
    }

    return { failure: "provider-error", kind: "failed" };
  }

  const body = (await response.json()) as GeminiResponse;

  if (body.error) {
    console.error(`[evidence-gemini] ${model}: ${body.error.message ?? ""}`);

    return { failure: "provider-error", kind: "failed" };
  }

  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  // A successful read of an image with no text on it. Distinct from a failed
  // read, and the difference says something about the file.
  return text ? { kind: "read", text } : { kind: "empty" };
}
