import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ counterUpdate: vi.fn() }));

vi.mock("@hostel/db/models/ApiUsageCounter", () => ({
  ApiUsageCounterModel: { findOneAndUpdate: mocks.counterUpdate },
}));

import { readWithVision, resetVisionClient } from "@/modules/finance/evidence-vision";

/**
 * A real RSA key, generated once for the suite.
 *
 * The JWT is signed for real rather than stubbed: signing is the one piece of
 * this module that a dependency would normally provide, so a test that mocks it
 * away tests nothing. Generating a 2048-bit key costs a fraction of a second and
 * proves `node:crypto` can actually produce the assertion Google expects.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});

/** The credential as it arrives from the environment: JSON, newlines escaped. */
function credential() {
  return JSON.stringify({
    client_email: "vision@hosteldays.iam.gserviceaccount.com",
    private_key: privateKey.replace(/\n/g, "\\n"),
  });
}

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function annotateResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

/** A minimal `fullTextAnnotation` with one word on it. */
function receiptBody(text = "Transaction Code 8823119471") {
  return {
    responses: [
      {
        fullTextAnnotation: {
          pages: [
            {
              blocks: [
                {
                  paragraphs: [
                    {
                      words: [
                        {
                          // `x` omitted on the left edge, which is what Vision
                          // actually sends when the coordinate is zero.
                          boundingBox: {
                            vertices: [{ y: 40 }, { x: 96, y: 40 }, { x: 96, y: 62 }, { y: 62 }],
                          },
                          confidence: 0.98,
                          symbols: [{ text: "8" }, { text: "8" }, { text: "2" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          text,
        },
      },
    ],
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetVisionClient();
  process.env.GCP_VISION_SA_KEY = credential();
  delete process.env.GCP_VISION_REGION;
  delete process.env.EVIDENCE_VISION_MONTHLY_CAP;
  // Well inside any cap.
  mocks.counterUpdate.mockReturnValue({ lean: () => Promise.resolve({ count: 12 }) });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GCP_VISION_SA_KEY;
  resetVisionClient();
});

describe("readWithVision", () => {
  it("reads the text and the word boxes off a receipt", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    const read = await readWithVision(Buffer.from("png"));

    expect(read.failure).toBeNull();
    expect(read.result?.engine).toBe("vision");
    expect(read.result?.text).toContain("8823119471");
    expect(read.result?.words).toHaveLength(1);
    // The omitted zero coordinate is read as zero, not dropped — text touching
    // the left edge of a receipt is common and must not lose its box.
    expect(read.result?.words[0]?.box).toEqual({ x0: 0, x1: 96, y0: 40, y1: 62 });
    expect(read.result?.words[0]?.text).toBe("882");
  });

  it("asks the synchronous endpoint for exactly one feature", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    await readWithVision(Buffer.from("png"));

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    // The async endpoints persist the image to a bucket for hours. Nothing here
    // may ever reach one — the whole module is built on the receipt being read
    // in memory and discarded.
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(url).not.toContain("asyncBatchAnnotate");

    const body = JSON.parse(String(init.body)) as {
      requests: Array<{ features: unknown[]; imageContext: { languageHints: string[] } }>;
    };

    // Billed per feature per image. A second one doubles the bill.
    expect(body.requests[0]?.features).toHaveLength(1);
    expect(body.requests[0]?.imageContext.languageHints).toContain("ne");
  });

  it("pins the endpoint to a region when one is configured", async () => {
    process.env.GCP_VISION_REGION = "eu";
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    await readWithVision(Buffer.from("png"));

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://eu-vision.googleapis.com/v1/images:annotate",
    );
  });

  it("mints one token and reuses it", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()))
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    await readWithVision(Buffer.from("png"));
    await readWithVision(Buffer.from("png"));

    // Three calls, not four: a round trip per read would be added latency on the
    // one request a resident is actually watching.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports not-configured when there is no credential", async () => {
    delete process.env.GCP_VISION_SA_KEY;
    resetVisionClient();

    const read = await readWithVision(Buffer.from("png"));

    expect(read).toEqual({ failure: "not-configured", result: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports not-configured when the credential is not JSON", async () => {
    process.env.GCP_VISION_SA_KEY = "oops-this-is-not-json";
    resetVisionClient();

    expect(await readWithVision(Buffer.from("png"))).toEqual({
      failure: "not-configured",
      result: null,
    });
  });

  it("distinguishes an empty read from a failed one", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse({ responses: [{}] }));

    const read = await readWithVision(Buffer.from("png"));

    // A successful read of an image carrying no text. That says something about
    // the file; a failure says something about us.
    expect(read).toEqual({ failure: "empty", result: null });
  });

  it("reports a provider error rather than inventing a read", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        annotateResponse({ responses: [{ error: { message: "quota" } }] }),
      );

    expect(await readWithVision(Buffer.from("png"))).toEqual({
      failure: "provider-error",
      result: null,
    });
  });

  it("reports a provider error on a non-200", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("nope", { status: 503 }));

    expect(await readWithVision(Buffer.from("png"))).toEqual({
      failure: "provider-error",
      result: null,
    });
  });

  it("reports a timeout when the call is aborted", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    expect(await readWithVision(Buffer.from("png"))).toEqual({
      failure: "timeout",
      result: null,
    });
  });

  it("stops calling once the monthly cap is passed", async () => {
    process.env.EVIDENCE_VISION_MONTHLY_CAP = "100";
    mocks.counterUpdate.mockReturnValue({
      lean: () => Promise.resolve({ count: 101 }),
    });

    const read = await readWithVision(Buffer.from("png"));

    expect(read).toEqual({ failure: "over-budget", result: null });
    // The point of the breaker: a bug that retries in a loop costs a dashboard
    // warning, not a bill.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts the call before making it", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    await readWithVision(Buffer.from("png"));

    // A loop that only counts its successes never trips the breaker.
    expect(mocks.counterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ service: "VISION_OCR" }),
      { $inc: { count: 1 } },
      expect.objectContaining({ upsert: true }),
    );
  });

  it("reads anyway when the counter itself is unavailable", async () => {
    mocks.counterUpdate.mockReturnValue({
      lean: () => Promise.reject(new Error("mongo is down")),
    });
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(annotateResponse(receiptBody()));

    // Switching off receipt reading platform-wide because a counter could not be
    // written would be a worse bug than the one the cap guards against.
    expect((await readWithVision(Buffer.from("png"))).failure).toBeNull();
  });

  it("reports not-configured when the token exchange is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad grant", { status: 400 }));

    expect(await readWithVision(Buffer.from("png"))).toEqual({
      failure: "not-configured",
      result: null,
    });
  });
});
