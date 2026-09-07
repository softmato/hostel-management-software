import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ counterUpdate: vi.fn() }));

vi.mock("@hostel/db/models/ApiUsageCounter", () => ({
  ApiUsageCounterModel: { findOneAndUpdate: mocks.counterUpdate },
}));

import {
  isGeminiConfigured,
  readWithGemini,
} from "@/modules/finance/evidence-gemini";

const IMAGE = Buffer.from("not really a jpeg, and it does not need to be");

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/** The shape Gemini actually returns: candidates → content → parts → text. */
function transcript(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/** The body of the single request the module made. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEYS", "key-one");
  // Off by default: the cap is exercised in its own tests, and leaving it on
  // would make every other test here depend on a database mock.
  vi.stubEnv("EVIDENCE_GEMINI_MONTHLY_CAP", "0");
  mocks.counterUpdate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("readWithGemini", () => {
  it("returns the transcription as the read text", async () => {
    fetchMock.mockResolvedValue(
      reply(transcript("Reference Code 111903076\nAmount (NPR) 70.00")),
    );

    const read = await readWithGemini(IMAGE);

    expect(read.failure).toBeNull();
    expect(read.result?.text).toBe("Reference Code 111903076\nAmount (NPR) 70.00");
    expect(read.result?.engine).toBe("gemini");
  });

  /*
   * Not a style preference. A language model asked to describe a receipt returns
   * prose, and prose has no labels for the parsers to key on — so the prompt
   * asks for a transcription and the request must keep saying so.
   */
  it("asks for a transcription rather than an interpretation", async () => {
    fetchMock.mockResolvedValue(reply(transcript("Status SUCCESS")));

    await readWithGemini(IMAGE);

    const prompt = sentBody(fetchMock).contents[0].parts[0].text.toLowerCase();

    expect(prompt).toContain("transcribe");
    expect(prompt).toContain("do not summarise");
  });

  it("sends the image inline with its mime type", async () => {
    fetchMock.mockResolvedValue(reply(transcript("x")));

    await readWithGemini(IMAGE, "image/png");

    const inline = sentBody(fetchMock).contents[0].parts[1].inline_data;

    expect(inline.mime_type).toBe("image/png");
    expect(inline.data).toBe(IMAGE.toString("base64"));
  });

  /*
   * Both of these are correctness, not tuning. Temperature above zero makes the
   * same receipt read differently on a retry, and the thinking budget is two
   * seconds of a resident's upload spent deliberating about a transcription.
   */
  it("reads deterministically and does not pay for hidden reasoning", async () => {
    fetchMock.mockResolvedValue(reply(transcript("x")));

    await readWithGemini(IMAGE);

    const config = sentBody(fetchMock).generationConfig;

    expect(config.temperature).toBe(0);
    expect(config.thinkingConfig.thinkingBudget).toBe(0);
  });

  it("never asks for word boxes it cannot measure", async () => {
    fetchMock.mockResolvedValue(reply(transcript("Amount 70")));

    const read = await readWithGemini(IMAGE);

    expect(read.result?.words).toEqual([]);
  });

  it("reports not-configured when there is no key", async () => {
    vi.stubEnv("GEMINI_API_KEYS", "");

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "not-configured", result: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes an empty read from a failed one", async () => {
    fetchMock.mockResolvedValue(reply(transcript("   ")));

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "empty", result: null });
  });

  /*
   * A fresh `Response` per call, not one shared object: the module falls through
   * the model list on a failure, and a body can only be read once. Reusing one
   * would make the second read throw and test the catch-all instead of the path
   * being asserted.
   */
  it("reports a provider error rather than inventing a read", async () => {
    fetchMock.mockImplementation(async () =>
      reply({ error: { message: "bad request" } }),
    );

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "provider-error", result: null });
  });

  /*
   * Google retires model names on its own schedule and closes older ones to new
   * projects, so a stale name in the default list is expected rather than
   * exceptional — it must cost the read nothing but the next attempt.
   */
  it("falls through to the next model when one is gone or spent", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(reply(transcript("Amount (NPR) 70.00")));

    const read = await readWithGemini(IMAGE);

    expect(read.result?.text).toBe("Amount (NPR) 70.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.1-flash-lite");
  });

  // A retired name costs a round trip and nothing else — it must not be logged
  // as an incident, because Google closes older models on its own schedule.
  it("moves past a model this project cannot reach", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_MODEL", "gone-model,good-model");
    fetchMock
      .mockResolvedValueOnce(reply({}, 404))
      .mockResolvedValueOnce(reply(transcript("Status SUCCESS")));

    const read = await readWithGemini(IMAGE);

    expect(read.result?.text).toBe("Status SUCCESS");
  });

  it("uses the configured model list when one is given", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_MODEL", "only-this-one");
    fetchMock.mockResolvedValue(reply(transcript("x")));

    await readWithGemini(IMAGE);

    expect(String(fetchMock.mock.calls[0][0])).toContain("only-this-one");
  });

  it("reports a provider error on a non-200", async () => {
    fetchMock.mockResolvedValue(reply({}, 500));

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "provider-error", result: null });
  });

  /*
   * The free tier is rate-limited per key, so a 429 is that key's minute rather
   * than the model's. A resident's upload should not fail because one key is
   * spent when another is sitting configured beside it.
   */
  it("moves to the next key when one is rate-limited", async () => {
    vi.stubEnv("GEMINI_API_KEYS", "spent, fresh ");
    fetchMock
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(reply(transcript("Amount 70")));

    const read = await readWithGemini(IMAGE);

    expect(read.result?.text).toBe("Amount 70");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["x-goog-api-key"]).toBe("fresh");
  });

  it("reports over-budget when every key is rate-limited", async () => {
    vi.stubEnv("GEMINI_API_KEYS", "one,two");
    fetchMock.mockResolvedValue(reply({}, 429));

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "over-budget", result: null });
  });

  it("reports a timeout when the call is aborted", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_TIMEOUT_MS", "5");
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "timeout", result: null });
  });

  it("stops calling once the monthly cap is passed", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_MONTHLY_CAP", "10");
    mocks.counterUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 11 }),
    });

    const read = await readWithGemini(IMAGE);

    expect(read).toEqual({ failure: "over-budget", result: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Counted before the call, so a retry loop trips the breaker rather than
  // riding under it forever.
  it("counts the call before making it", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_MONTHLY_CAP", "10");
    mocks.counterUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 1 }),
    });
    fetchMock.mockResolvedValue(reply(transcript("Amount 70")));

    await readWithGemini(IMAGE);

    expect(mocks.counterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ service: "GEMINI_OCR" }),
      { $inc: { count: 1 } },
      expect.objectContaining({ upsert: true }),
    );
  });

  it("reads anyway when the counter itself is unavailable", async () => {
    vi.stubEnv("EVIDENCE_GEMINI_MONTHLY_CAP", "10");
    mocks.counterUpdate.mockImplementation(() => {
      throw new Error("mongo is down");
    });
    fetchMock.mockResolvedValue(reply(transcript("Amount 70")));

    const read = await readWithGemini(IMAGE);

    expect(read.result?.text).toBe("Amount 70");
  });
});

describe("isGeminiConfigured", () => {
  it("is false with no key and true with one", () => {
    vi.stubEnv("GEMINI_API_KEYS", "");
    expect(isGeminiConfigured()).toBe(false);

    vi.stubEnv("GEMINI_API_KEYS", "key-one");
    expect(isGeminiConfigured()).toBe(true);
  });
});
