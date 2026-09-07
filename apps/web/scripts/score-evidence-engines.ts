/**
 * Scores the evidence recognisers against the golden set (evidence pipeline,
 * phase 0).
 *
 * ## Why this exists before the migration and not after it
 *
 * The pipeline's failure mode is silence. Every engine error degrades to "no
 * text", "no text" degrades to an amber flag, and an amber flag degrades to a
 * warden clicking through. A recogniser can be completely dead in production —
 * and was — while every test passes, every local run reads receipts perfectly,
 * and the only symptom is residents being told their receipts are unreadable.
 *
 * Nothing in that chain produces a number. This does.
 *
 * ## Fields, not characters
 *
 * Text similarity is the wrong measure and would actively mislead here. An
 * engine can get 95% of the characters on a receipt right and corrupt the one
 * digit of the transaction id that the claim turns on; it can also differ on
 * every line break while agreeing on every fact. What the product cares about is
 * whether the resident ends up submitting the right numbers, so each field gets
 * a verdict of its own:
 *
 *   exact    the value matches the ground truth
 *   near     one character out — recoverable by a human, not by a check
 *   wrong    a confident, different answer. The worst outcome: it fills the form.
 *   missing  nothing was extracted
 *
 * The headline is `allCritical`: amount, transaction id, direction and outcome
 * all exact on one file. That is the bar for a claim that can be auto-triaged,
 * and it is the only number worth comparing engines on.
 *
 * ## Go / no-go
 *
 * Vision's `allCritical` rate should beat Tesseract's by at least 25 points on
 * the image buckets. If it does not, the preprocessing is wrong rather than the
 * engine — stop and look at `prepareForVision` before shipping anything.
 *
 * Usage:
 *   EVIDENCE_VISION_MONTHLY_CAP=0 \
 *   node --experimental-transform-types --import ./scripts/register-ts-hook.mjs \
 *     scripts/score-evidence-engines.ts [--engine vision|tesseract|both]
 *
 * `EVIDENCE_VISION_MONTHLY_CAP=0` switches the billing breaker off for the run,
 * which also keeps the script from touching Mongo at all.
 */

import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readEvidenceDirection } from "@/modules/finance/evidence-direction";
import { extractClaimFields, referenceOnEvidence, looksLikePaymentReceipt } from "@/modules/finance/evidence-ocr";
import { parseReceipt } from "@/modules/finance/evidence-receipt";

/*
 * The billing breaker is off for a scoring run, and that also keeps the script
 * out of Mongo: `withinMonthlyCap` returns early on a non-positive cap without
 * touching the counter. A scorer that stalled ten seconds per file waiting on a
 * database connection it does not have would be unusable, and counting a
 * benchmark against the production allowance would be wrong anyway.
 */
process.env.EVIDENCE_VISION_MONTHLY_CAP ??= "0";

const GOLDEN_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "evidence-golden",
);

type ManifestEntry = {
  amount: number;
  direction: string;
  file: string;
  isPaymentReceipt: boolean;
  outcome: string;
  payee: string | null;
  provider: string;
  referenceCode: string | null;
  txnId: string | null;
  variant?: string;
};

type Verdict = "exact" | "missing" | "near" | "wrong";

/** One character's difference, which is what a misread digit looks like. */
function isNear(expected: string, actual: string): boolean {
  if (Math.abs(expected.length - actual.length) > 1) return false;

  if (expected.length === actual.length) {
    let differences = 0;

    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index] !== actual[index]) differences += 1;
      if (differences > 1) return false;
    }

    return differences === 1;
  }

  const [longer, shorter] =
    expected.length > actual.length ? [expected, actual] : [actual, expected];

  for (let skip = 0; skip < longer.length; skip += 1) {
    if (longer.slice(0, skip) + longer.slice(skip + 1) === shorter) return true;
  }

  return false;
}

function score(expected: string | null, actual: string | null | undefined): Verdict {
  const want = (expected ?? "").trim().toUpperCase();
  const got = (actual ?? "").toString().trim().toUpperCase();

  // Nothing expected and nothing produced is a correct answer, not a gap.
  if (!want) return got ? "wrong" : "exact";
  if (!got) return "missing";
  if (want === got) return "exact";

  return isNear(want, got) ? "near" : "wrong";
}

type FileScore = {
  allCritical: boolean;
  amount: Verdict;
  direction: Verdict;
  engine: string;
  file: string;
  isReceipt: Verdict;
  ms: number;
  outcome: Verdict;
  payee: Verdict;
  reference: Verdict;
  textRead: boolean;
  txnId: Verdict;
  variant: string;
};

/**
 * Everything the claim pipeline would derive from this text.
 *
 * Runs the *real* readers rather than re-implementing them, which is the whole
 * point: a scorer with its own parser measures the scorer. If
 * `extractClaimFields` gets worse, this number moves, and that is correct — the
 * question is never "did the engine see the pixels" but "would the resident have
 * submitted the right claim".
 */
function fieldsFrom(text: string, truth: ManifestEntry) {
  const scanned = extractClaimFields(text);
  const receipt = parseReceipt(text);
  const direction = readEvidenceDirection(text);

  return {
    amount: scanned.amount ?? receipt.amount ?? null,
    direction: direction.direction,
    isReceipt: looksLikePaymentReceipt(text),
    outcome: direction.outcome,
    payee: receipt.payee,
    reference: truth.referenceCode
      ? referenceOnEvidence(text, truth.referenceCode)
        ? truth.referenceCode
        : null
      : null,
    txnId: scanned.transactionCode ?? receipt.txnId ?? null,
  };
}

type Engine = "gemini" | "tesseract" | "vision";

/** Milliseconds to wait between files, so a free tier is not hammered. */
function paceMs(engine: Engine): number {
  const flag = process.argv.indexOf("--pace");

  if (flag !== -1) return Number(process.argv[flag + 1]) || 0;

  // Gemini's free tier allows a handful of requests a minute; local engines have
  // no such limit and pausing between them would only waste the operator's time.
  return engine === "gemini" ? 6_500 : 0;
}

async function scoreEngine(
  engine: Engine,
  manifest: ManifestEntry[],
): Promise<FileScore[]> {
  process.env.EVIDENCE_ENGINE = engine;

  // Imported per engine, and inside the loop body rather than at the top of the
  // file, because `evidenceEngineMode()` reads the environment. A module-level
  // import would bind whichever engine happened to be set when the script
  // started and silently score it twice.
  const { readEvidence } = await import("@/modules/finance/evidence-ocr");
  const scores: FileScore[] = [];

  /*
   * Free-tier engines are rate-limited per minute, and a scoring run is the
   * densest burst of calls this corpus will ever produce. Without a pace the
   * run collapses into a wall of 429s and reports the engine as broken when the
   * only thing broken was the harness's manners. `--pace 0` switches it off.
   */
  const pace = paceMs(engine);

  for (const [index, entry] of manifest.entries()) {
    if (pace > 0 && index > 0) {
      await new Promise((resolve) => setTimeout(resolve, pace));
    }

    const bytes = await readFile(path.join(GOLDEN_DIR, entry.file));
    const mimeType = entry.file.endsWith(".pdf")
      ? "application/pdf"
      : entry.file.endsWith(".png")
        ? "image/png"
        : "image/jpeg";
    const startedAt = Date.now();
    const read = await readEvidence(bytes, mimeType);
    const ms = read.result?.ms || Date.now() - startedAt;
    const text = read.result?.text ?? null;

    if (text === null) {
      scores.push({
        allCritical: false,
        amount: "missing",
        direction: "missing",
        engine,
        file: entry.file,
        isReceipt: "missing",
        ms,
        outcome: "missing",
        payee: "missing",
        reference: "missing",
        textRead: false,
        txnId: "missing",
        variant: entry.variant ?? "real",
      });

      continue;
    }

    const found = fieldsFrom(text, entry);
    const amount = score(
      entry.amount ? String(entry.amount) : null,
      found.amount === null ? null : String(found.amount),
    );
    const txnId = score(entry.txnId, found.txnId);
    const direction = score(entry.direction, found.direction);
    const outcome = score(entry.outcome, found.outcome);

    scores.push({
      // The bar for a claim a human never has to open.
      allCritical:
        amount === "exact" &&
        txnId === "exact" &&
        direction === "exact" &&
        outcome === "exact",
      amount,
      direction,
      engine,
      file: entry.file,
      isReceipt: score(
        String(entry.isPaymentReceipt),
        String(found.isReceipt),
      ),
      ms,
      outcome,
      payee: score(entry.payee, found.payee),
      reference: score(entry.referenceCode, found.reference),
      textRead: true,
      txnId,
      variant: entry.variant ?? "real",
    });
  }

  return scores;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;
}

function summarise(scores: FileScore[]) {
  const read = scores.filter((row) => row.textRead).length;
  const critical = scores.filter((row) => row.allCritical).length;
  const exact = (field: keyof FileScore) =>
    scores.filter((row) => row[field] === "exact").length;
  // The number that actually matters for fraud: a confident wrong answer fills
  // the resident's form with it and nothing downstream questions it.
  const wrongTxn = scores.filter((row) => row.txnId === "wrong").length;

  return {
    allCritical: percent(critical, scores.length),
    amountExact: percent(exact("amount"), scores.length),
    directionExact: percent(exact("direction"), scores.length),
    files: scores.length,
    medianMs: scores.map((row) => row.ms).sort((a, b) => a - b)[
      Math.floor(scores.length / 2)
    ],
    outcomeExact: percent(exact("outcome"), scores.length),
    textRead: percent(read, scores.length),
    txnIdExact: percent(exact("txnId"), scores.length),
    txnIdWrong: wrongTxn,
  };
}

async function main() {
  const requested = process.argv.includes("--engine")
    ? process.argv[process.argv.indexOf("--engine") + 1]
    : "both";
  const engines: Engine[] =
    requested === "both"
      ? ["tesseract", "vision"]
      : (requested ?? "").split(",").map((name) => name.trim() as Engine);

  let manifest: ManifestEntry[];

  try {
    manifest = JSON.parse(
      await readFile(path.join(GOLDEN_DIR, "manifest.json"), "utf8"),
    ) as ManifestEntry[];
  } catch {
    console.error(
      `No manifest at ${GOLDEN_DIR}. Run scripts/make-evidence-fixtures.ts first, and add real receipts beside it.`,
    );
    process.exitCode = 1;

    return;
  }

  // Checked per file rather than by listing the directory: real receipts live in
  // a `real/` subfolder, so a flat listing would report every one of them as
  // absent and silently score only the synthetic half.
  const present = new Set<string>();

  for (const entry of manifest) {
    try {
      await access(path.join(GOLDEN_DIR, entry.file));
      present.add(entry.file);
    } catch {
      // Recorded as missing below.
    }
  }

  const missing = manifest.filter((entry) => !present.has(entry.file));

  if (missing.length > 0) {
    // Loud rather than skipped: a manifest row with no file is a fixture
    // somebody meant to include, and quietly scoring the rest overstates the
    // corpus.
    console.warn(
      `${missing.length} manifest rows have no file and are skipped: ${missing
        .map((entry) => entry.file)
        .join(", ")}`,
    );
  }

  /*
   * `--variant real` scores only the hand-labelled receipts.
   *
   * They are the only files that say anything about how the pipeline behaves on
   * what residents actually send, and on a metered engine they are also a third
   * of the quota of a full run. The synthetic degradation ladder answers a
   * different question and does not need re-answering on every pass.
   */
  const wanted = process.argv.includes("--variant")
    ? process.argv[process.argv.indexOf("--variant") + 1]
    : null;
  const scored = manifest
    .filter((entry) => present.has(entry.file))
    .filter((entry) => !wanted || (entry.variant ?? "real") === wanted);
  const rows: FileScore[] = [];

  for (const engine of engines) {
    console.log(`\nScoring ${engine} over ${scored.length} files...`);

    const scores = await scoreEngine(engine, scored);

    rows.push(...scores);
    console.table(summarise(scores));

    // Per-degradation, because the aggregate hides the case that matters. An
    // engine can look fine overall and collapse on `whatsapp`, which is the
    // variant most residents actually send.
    const variants = [...new Set(scores.map((row) => row.variant))].sort();

    console.table(
      Object.fromEntries(
        variants.map((variant) => [
          variant,
          summarise(scores.filter((row) => row.variant === variant)),
        ]),
      ),
    );
  }

  const header = [
    "engine",
    "file",
    "variant",
    "textRead",
    "allCritical",
    "amount",
    "txnId",
    "direction",
    "outcome",
    "payee",
    "reference",
    "isReceipt",
    "ms",
  ];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      header.map((key) => String(row[key as keyof FileScore])).join(","),
    ),
  ].join("\n");
  const csvPath = path.join(GOLDEN_DIR, "scores.csv");

  await writeFile(csvPath, `${csv}\n`);
  console.log(`\nPer-file scores written to ${csvPath}`);

  if (engines.length === 2) {
    const rate = (engine: string) =>
      rows.filter((row) => row.engine === engine && row.allCritical).length /
      Math.max(1, rows.filter((row) => row.engine === engine).length);
    const gap = Math.round((rate("vision") - rate("tesseract")) * 100);

    console.log(
      `\nVision is ${gap} points ${gap < 0 ? "behind" : "ahead"} of Tesseract on all-critical-correct.`,
    );

    if (gap < 25) {
      console.log(
        "Below the 25-point go/no-go. That points at the preprocessing rather than the engine — check prepareForVision before shipping.",
      );
    }
  }
}

void main();
