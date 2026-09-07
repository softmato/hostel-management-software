import { createSign } from "node:crypto";

import type {
  EvidenceReadFailure,
  OcrResult,
  OcrWord,
} from "@/modules/finance/evidence-engine";

/**
 * Reading a receipt with Google Cloud Vision.
 *
 * Replaces Tesseract on the image path. The reason is not that Tesseract reads
 * badly — handed a clean receipt on a developer's machine it reads it perfectly
 * in about 600 ms. The reason is that it could not be made to run *in
 * production*: it resolves a worker script, six WASM cores and a 5 MB language
 * model out of `node_modules` at runtime, by paths assembled from runtime
 * feature detection, and a serverless bundler cannot trace any of them. Three
 * separate fixes went in for that — vendored model, explicit trace includes,
 * external packages — and the recogniser still returned nothing on every claim,
 * silently, because every failure mode in this pipeline degrades to `null`.
 *
 * **This module has no runtime files.** No worker, no WASM, no model, no native
 * binary, no SDK. It is `fetch` and `node:crypto`, which is the same call the
 * LLM router in `lib/llm` makes for the same reason. There is nothing here for a
 * bundler to lose.
 *
 * ## Non-negotiables
 *
 * - **The synchronous endpoint only.** `images:annotate` processes in memory and
 *   persists nothing. The async variants (`files:asyncBatchAnnotate`) write the
 *   image to a bucket and hold it for hours, which would break the property this
 *   whole module is built to keep: a payment screenshot is read and discarded,
 *   never stored anywhere it can be searched. No code path here may ever call
 *   one.
 * - **Exactly one feature.** Vision bills per feature per image. `LABEL_DETECTION`
 *   alongside `DOCUMENT_TEXT_DETECTION` would double the bill and tell us nothing
 *   a receipt parser can use.
 * - **A service account, never an API key.** The key is server-side only and is
 *   never reachable from the app. An API key in a mobile binary is a key on the
 *   open internet.
 * - **Failure is `null`, and never a fallback.** See `evidence-engine`: a
 *   Tesseract read standing in for a failed Vision read produces false
 *   confirmations, which is the one outcome worse than no signal.
 */

/** Where the token is minted. Same for every region. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The scope a Vision call needs. Nothing narrower is offered. */
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * How long a single annotate call may take.
 *
 * Vision answers a phone screenshot in 400-900 ms. Anything past six seconds is
 * a network problem rather than a slow read, and the resident is watching an
 * upload bar — a claim that hangs is worse than a claim with no OCR signal.
 */
const DEFAULT_TIMEOUT_MS = 6_000;

/** Free tier is 1,000 units a month. The cap is a runaway guard, not a budget. */
const DEFAULT_MONTHLY_CAP = 5_000;

type ServiceAccount = { clientEmail: string; privateKey: string };

/**
 * The credential, parsed once.
 *
 * Cached including the failure: a malformed or absent key will not repair itself
 * inside one process, and re-parsing 2 KB of JSON per claim to reach the same
 * answer is work for nothing.
 */
let credential: ServiceAccount | null | undefined;

function serviceAccount(): ServiceAccount | null {
  if (credential !== undefined) return credential;

  credential = null;

  const raw = process.env.GCP_VISION_SA_KEY;

  if (!raw) return credential;

  try {
    const parsed = JSON.parse(raw) as {
      client_email?: string;
      private_key?: string;
    };

    if (!parsed.client_email || !parsed.private_key) return credential;

    credential = {
      clientEmail: parsed.client_email,
      // Almost every way of putting a PEM into an environment variable escapes
      // the newlines, and a PEM whose newlines are the two characters `\` and
      // `n` is not a PEM — `createSign` rejects it with an error that says
      // nothing useful about why.
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    // A key that is not JSON is a key we do not have.
    credential = null;
  }

  return credential;
}

/** Exported so callers can tell "switched off" from "tried and failed". */
export function isVisionConfigured(): boolean {
  return serviceAccount() !== null;
}

/**
 * The regional endpoint, or the global one.
 *
 * Pinning matters for data residency: `eu` keeps processing inside the EU,
 * `us` inside the US. Unset means the global endpoint, which routes to whatever
 * region is closest — fine technically, and the thing to change before anyone
 * signs a data-processing agreement that names a jurisdiction.
 */
function annotateUrl(): string {
  const region = (process.env.GCP_VISION_REGION ?? "").toLowerCase();
  const host =
    region === "eu" || region === "us"
      ? `${region}-vision.googleapis.com`
      : "vision.googleapis.com";

  return `https://${host}/v1/images:annotate`;
}

function base64url(value: Buffer | string): string {
  return (typeof value === "string" ? Buffer.from(value) : value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A self-signed JWT, exchanged for an access token.
 *
 * This is the whole of the `google-auth-library` dependency that a Vision SDK
 * would pull in: an RS256 signature over two JSON objects. `node:crypto` signs
 * it, which keeps this module free of anything a bundler has to find on disk.
 */
function assertion(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
      iss: account.clientEmail,
      scope: SCOPE,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(account.privateKey);

  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * The access token, cached until shortly before it expires.
 *
 * Google issues these for an hour. A serverless container handles many claims
 * over its life, so minting one per read would add a round trip to every upload
 * a resident is watching for no reason at all.
 */
let token: { expiresAt: number; value: string } | null = null;

async function accessToken(signal: AbortSignal): Promise<string | null> {
  const account = serviceAccount();

  if (!account) return null;

  // Sixty seconds of headroom, so a token that is about to expire is replaced
  // rather than used and rejected.
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  try {
    const response = await fetch(TOKEN_URL, {
      body: new URLSearchParams({
        assertion: assertion(account),
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!body.access_token) return null;

    token = {
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      value: body.access_token,
    };

    return token.value;
  } catch {
    return null;
  }
}

/** The vendor's billing month, which is Gregorian and UTC. */
function billingPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Counts this call and says whether it was inside the cap.
 *
 * Counted *before* the call rather than after it, deliberately: the failure this
 * guards against is a retry loop, and a loop that only counts its successes is a
 * loop that never trips the breaker.
 *
 * A counter that cannot be written does not stop the read. The cap exists to
 * bound a bug; letting a transient database problem switch off receipt reading
 * platform-wide would be a worse bug than the one it guards against.
 */
async function withinMonthlyCap(): Promise<boolean> {
  const cap = Number(process.env.EVIDENCE_VISION_MONTHLY_CAP ?? DEFAULT_MONTHLY_CAP);

  if (!Number.isFinite(cap) || cap <= 0) return true;

  try {
    /*
     * Imported here rather than at the top of the file.
     *
     * The counter is the only thing in this module that touches the database,
     * and reaching it drags in mongoose — which is CommonJS, and so cannot be
     * named-imported from a plain ESM script. Keeping it lazy means a deployment
     * with the cap switched off never loads it at all, and the scoring harness
     * can import the recogniser without a database anywhere near it.
     */
    const { ApiUsageCounterModel } = await import(
      "@hostel/db/models/ApiUsageCounter"
    );
    const counter = await ApiUsageCounterModel.findOneAndUpdate(
      { period: billingPeriod(), service: "VISION_OCR" },
      { $inc: { count: 1 } },
      { new: true, upsert: true },
    ).lean<{ count?: number } | null>();
    const used = counter?.count ?? 0;

    if (used > cap) {
      // Loud, because the only correct response is a human deciding whether the
      // cap is too low or something is looping.
      console.error(
        `[evidence-vision] monthly cap reached: ${used} calls against a cap of ${cap} for ${billingPeriod()} — receipts are no longer being machine-read`,
      );

      return false;
    }

    return true;
  } catch {
    return true;
  }
}

type VisionVertex = { x?: number; y?: number };

type VisionWord = {
  boundingBox?: { vertices?: VisionVertex[] };
  confidence?: number;
  symbols?: Array<{ text?: string }>;
};

type VisionResponse = {
  responses?: Array<{
    error?: { message?: string };
    fullTextAnnotation?: {
      pages?: Array<{
        blocks?: Array<{
          paragraphs?: Array<{ words?: VisionWord[] }>;
        }>;
      }>;
      text?: string;
    };
  }>;
};

/**
 * The bounding box, as the smallest rectangle containing the polygon.
 *
 * Vision returns four vertices and **omits a coordinate when it is zero**, which
 * is the kind of detail that produces a parser which works on every receipt
 * except the ones with text touching the left edge. Defaulting the absent
 * coordinate to zero is the documented reading, not a guess.
 */
function boxOf(vertices: VisionVertex[]): OcrWord["box"] {
  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);

  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

function wordsFrom(response: VisionResponse["responses"]): OcrWord[] {
  const words: OcrWord[] = [];

  for (const page of response?.[0]?.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? [])
            .map((symbol) => symbol.text ?? "")
            .join("");
          const vertices = word.boundingBox?.vertices ?? [];

          if (!text || vertices.length === 0) continue;

          words.push({
            box: boxOf(vertices),
            confidence: word.confidence ?? 1,
            text,
          });
        }
      }
    }
  }

  return words;
}

export type VisionRead = { failure: EvidenceReadFailure; result: null } | {
  failure: null;
  result: NonNullable<OcrResult>;
};

/**
 * Reads the image, or explains why it did not.
 *
 * The failure reason is returned rather than logged and swallowed because the
 * defect this pipeline actually shipped was not a bad read — it was a read that
 * failed identically to every other kind of failure, so nobody could see that it
 * was failing at all. Callers report it on the stream and log it on the claim
 * path; nothing branches on it.
 */
export async function readWithVision(prepared: Buffer): Promise<VisionRead> {
  if (!serviceAccount()) return { failure: "not-configured", result: null };

  if (!(await withinMonthlyCap())) return { failure: "over-budget", result: null };

  const budget = Number(
    process.env.EVIDENCE_VISION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_TIMEOUT_MS,
  );
  const startedAt = Date.now();

  try {
    const bearer = await accessToken(controller.signal);

    if (!bearer) return { failure: "not-configured", result: null };

    const response = await fetch(annotateUrl(), {
      body: JSON.stringify({
        requests: [
          {
            // One feature, and it is the document-oriented one: receipts are
            // dense structured text, and `TEXT_DETECTION` is tuned for signs and
            // photographs of the world.
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            image: { content: prepared.toString("base64") },
            // Nepali wallets print Devanagari beside Latin on the same line.
            // Without the hint the mixed script reads far worse than either
            // alone — this is the whole reason the old pipeline needed a
            // Devanagari digit table.
            imageContext: { languageHints: ["en", "ne"] },
          },
        ],
      }),
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[evidence-vision] annotate failed: HTTP ${response.status} ${response.statusText}`,
      );

      return { failure: "provider-error", result: null };
    }

    const body = (await response.json()) as VisionResponse;
    const first = body.responses?.[0];

    if (first?.error) {
      console.error(`[evidence-vision] annotate error: ${first.error.message ?? ""}`);

      return { failure: "provider-error", result: null };
    }

    const text = (first?.fullTextAnnotation?.text ?? "").trim();

    // A successful read of an image with no text on it. Distinct from a failed
    // read, and the difference matters: this one says something about the file.
    if (!text) return { failure: "empty", result: null };

    return {
      failure: null,
      result: {
        engine: "vision",
        ms: Date.now() - startedAt,
        text,
        words: wordsFrom(body.responses),
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";

    if (!aborted) {
      console.error("[evidence-vision] annotate threw", error);
    }

    return { failure: aborted ? "timeout" : "unknown", result: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: drops the cached credential and token. */
export function resetVisionClient() {
  credential = undefined;
  token = null;
}
