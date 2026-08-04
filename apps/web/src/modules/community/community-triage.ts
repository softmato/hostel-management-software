import { parseModelJson } from "@/lib/llm/json";
import { llmGenerate } from "@/lib/llm/providers";

/**
 * Report triage for community posts.
 *
 * Reports are cheap to file and easy to abuse, so a single one is never enough
 * to act on. Two things can put a post in front of a human:
 *
 * 1. **Volume.** {@link REPORT_QUEUE_THRESHOLD} distinct people reported it.
 *    This is the rule that always works — it needs no API key and no network.
 * 2. **Content.** The automated check read the post and the reasons given and
 *    judged it likely to break the rules. This catches the first report on
 *    something genuinely bad, before a queue of victims forms.
 *
 * Neither path hides a post. Flagging asks a moderator to look; only a person
 * takes something down. That keeps a coordinated pile-on from silencing someone
 * and keeps a confidently wrong 8B model from doing the same.
 */

/** Distinct reporters needed before a post is queued regardless of content. */
export const REPORT_QUEUE_THRESHOLD = 3;

const SYSTEM_PROMPT =
  "You are a content moderator for a student hostel community app in Nepal. " +
  "You judge whether a reported post plausibly breaks the rules. You are " +
  "conservative: disagreement, criticism of a hostel, complaints, and blunt " +
  "language are all allowed.";

export type TriageVerdict = {
  /** Short reason shown to the moderator who picks the post up. */
  reason: string;
  shouldQueue: boolean;
};

/**
 * Ask the model whether a reported post deserves a moderator's attention.
 *
 * Returns `null` when there is no answer — no provider configured, quota spent,
 * or unparseable output. Callers fall back to the volume threshold, which is
 * why this never throws and never blocks the report being recorded.
 */
export async function triageReportedPost(input: {
  body: string;
  reasons: string[];
}): Promise<TriageVerdict | null> {
  const prompt = [
    "A post was reported. Decide whether a human moderator should review it.",
    "",
    "POST:",
    input.body.slice(0, 2000),
    "",
    "REPORT REASONS:",
    ...input.reasons.slice(0, 5).map((reason) => `- ${reason.slice(0, 300)}`),
    "",
    'Answer with JSON only: { "shouldQueue": boolean, "reason": string }',
    "",
    "Rules:",
    "- shouldQueue true only for: harassment or threats of a named person,",
    "  hate speech, sexual content, doxxing, scams, or spam advertising.",
    "- A negative opinion about a hostel, its food, or its staff is NOT a",
    "  reason to queue. Neither is bad grammar, a joke, or a heated argument.",
    "- If the report reasons look like retaliation against an opinion, answer",
    "  false.",
    "- reason: one short sentence, max 120 characters, naming the rule at stake.",
  ].join("\n");

  const raw = await llmGenerate(prompt, {
    json: true,
    maxTokens: 200,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
  });

  if (!raw.trim()) {
    return null;
  }

  const payload = parseModelJson<{ reason?: unknown; shouldQueue?: unknown }>(
    raw,
    "triageReportedPost",
  );

  if (!payload || typeof payload.shouldQueue !== "boolean") {
    return null;
  }

  const reason =
    typeof payload.reason === "string" && payload.reason.trim()
      ? payload.reason.trim().slice(0, 120)
      : "Flagged by automated review.";

  return { reason, shouldQueue: payload.shouldQueue };
}
