/**
 * What an evidence read produces, and which engine is allowed to produce it.
 *
 * Split into its own module so `evidence-ocr` and `evidence-vision` can share
 * the contract without importing each other — the recogniser dispatches to the
 * engines, so the types cannot live with either one of them.
 *
 * ## Why the shape changed
 *
 * The old contract was `Promise<string | null>`: the text, or nothing. That was
 * exactly right for Tesseract, which returns a blob of characters and has no
 * idea where on the page any of them were. It is the wrong contract for a
 * document recogniser, which knows where every word sits — and the position is
 * the part that makes a parser stop breaking. A two-column bank voucher is
 * unreadable as a character stream and trivial as coordinates: find the word
 * `Amount`, read the row to its right.
 *
 * So the result carries `words`. Engines that cannot supply them return `[]`,
 * and every consumer that does not want them keeps working unchanged.
 */

/** One recognised word, with where it sat on the page. */
export type OcrWord = {
  /** Pixel box in the coordinate space of the image that was submitted. */
  box: { x0: number; x1: number; y0: number; y1: number };
  /** 0-1. Engines with no per-word confidence report 1. */
  confidence: number;
  text: string;
};

/**
 * A completed read.
 *
 * **Null is the only failure value, and it is never a partial guess.** Disabled,
 * unconfigured, over budget, timed out, refused by the vendor, or a response
 * that did not parse — the caller cannot act differently on any of them, and the
 * one thing it must never do is treat a degraded read as a read. `null` becomes
 * `EVIDENCE_NOT_MACHINE_CHECKED`, which puts a human in front of the image; a
 * partial read becomes a *confirmation*, which is the signal a reviewer trusts
 * without opening the file.
 */
export type OcrResult = {
  engine: EvidenceEngine | "pdf-text";
  /** Wall-clock time the read took, for the divergence log and for budgets. */
  ms: number;
  text: string;
  words: OcrWord[];
} | null;

export type EvidenceEngine = "gemini" | "tesseract" | "vision";

/**
 * Which engine reads images, and whether the other one shadows it.
 *
 * - `vision` — Cloud Vision only. A failure is `null`, and **there is no
 *   fallback to Tesseract by design**: `EVIDENCE_TEXT_MATCHES_CLAIM` and
 *   `EVIDENCE_REFERENCE_ON_IMAGE` are confirmation signals, and a fuzzy
 *   Tesseract read that happens to match one produces a false green light —
 *   strictly worse than no signal at all, because it is the signal nobody
 *   double-checks.
 * - `gemini` — a multimodal model transcribing the page. The engine that runs
 *   when there is no Cloud Vision credential, which is the standing situation:
 *   Vision needs billing enabled and billing needs a payment card. Gemini's free
 *   tier needs neither, and its key is already in this repo.
 * - `tesseract` — the old engine, kept only so a deployment with no remote
 *   credentials still reads PDFs and can still read images badly rather than not
 *   at all. **It does not run in the Vercel lambda**, so in production it is a
 *   placeholder rather than a fallback.
 * - `shadow` — both run; Tesseract's answer drives behaviour and the divergence
 *   is logged. The rollout lever, and the only mode that costs two reads.
 * - `vision+gemini` — Vision reads, and Gemini reads only when Vision did not
 *   answer at all. **The production mode**, and the one exception to the
 *   no-fallback rule above — because that rule was written against Tesseract,
 *   and Gemini is not Tesseract. Tesseract scores 16% all-critical on the real
 *   corpus and Gemini 68%, so Gemini's answer is a second opinion rather than a
 *   fuzzy guess that manufactures the false confirmations the rule exists to
 *   prevent. What it guards against is the failure this pipeline has already
 *   suffered twice: one remote dependency goes away — an expired card, a lapsed
 *   billing account, a revoked key, a spent quota — and takes every receipt read
 *   on the platform down with it, silently.
 */
export type EvidenceEngineMode = EvidenceEngine | "shadow" | "vision+gemini";

export function evidenceEngineMode(): EvidenceEngineMode {
  const configured = (process.env.EVIDENCE_ENGINE ?? "").toLowerCase();

  if (
    configured === "gemini" ||
    configured === "shadow" ||
    configured === "tesseract" ||
    configured === "vision" ||
    configured === "vision+gemini"
  ) {
    return configured;
  }

  /*
   * Unset resolves to the best engine that is actually credentialled.
   *
   * Deliberately not "always Tesseract": a deployment that adds a credential and
   * forgets the flag should get the working engine rather than silently keep the
   * broken one, and that is precisely the mistake this pipeline has already made
   * once — the recogniser was dead in production for weeks while every local run
   * stayed green, because nothing anywhere said which engine was live.
   *
   * Vision leads because it measures word boxes and Gemini does not. Tesseract
   * is last because in the runtime that matters it does not run at all.
   */
  const vision = Boolean(process.env.GCP_VISION_SA_KEY);
  const gemini = Boolean((process.env.GEMINI_API_KEYS ?? "").trim());

  /*
   * Two credentials resolve to the pair, not to Vision alone. A deployment
   * holding two working engines should not lose receipt reading outright
   * because one vendor is having a bad morning, and the second read is only
   * ever paid for on the reads the first one failed.
   *
   * `vision` remains available as an explicit setting, and has to be: the
   * scoring harness sets EVIDENCE_ENGINE to the engine it is measuring, so a
   * `vision` that quietly answered with Gemini would report Gemini's score as
   * Vision's — and this pipeline's whole history is measurements that were not
   * measuring what they claimed.
   */
  if (vision && gemini) return "vision+gemini";
  if (vision) return "vision";
  if (gemini) return "gemini";

  return "tesseract";
}

/**
 * Why a read produced nothing.
 *
 * **The entire reason this exists**: for the life of this feature, every failure
 * mode collapsed into `null`, and `null` reached the resident as one sentence —
 * "We could not read this one". Vision unreachable, credentials missing, budget
 * exhausted, engine never installed, a genuinely unreadable photo: all the same
 * sentence, and no way for anyone to tell which. The recogniser was dead in
 * production for weeks behind it, and the only visible symptom was residents
 * being told their receipts were unreadable.
 *
 * Reported on the read stream and logged on the claim path. It is diagnostic,
 * never a verdict: nothing branches on it and no flag is derived from it.
 */
export type EvidenceReadFailure =
  /** `EVIDENCE_OCR=off`. Nobody looked, on purpose. */
  | "disabled"
  /** The engine ran and the image genuinely carries no text. */
  | "empty"
  /** The engine is selected but has no usable credentials. */
  | "not-configured"
  /** Past `EVIDENCE_VISION_MONTHLY_CAP` for this billing month. */
  | "over-budget"
  /** The vendor answered with an error, or an unparseable body. */
  | "provider-error"
  /** The read did not finish inside its budget. */
  | "timeout"
  /** Something threw. The catch-all, and it should stay rare. */
  | "unknown";
