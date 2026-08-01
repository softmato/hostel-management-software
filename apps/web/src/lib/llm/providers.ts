/**
 * Free-tier LLM router. Walks a configured provider order, and within each
 * provider a list of keys, until one returns text. A key that reports a quota
 * or rate-limit error is parked until the next UTC midnight (which is when the
 * free tiers reset) so later calls skip straight past it.
 *
 * Every provider is reached over plain `fetch` rather than its official SDK —
 * four of the five are OpenAI-compatible, and keeping the dependency list empty
 * matters more here than SDK ergonomics for a serverless bundle.
 *
 * Exhaustion state is per-process. On serverless that means a cold start
 * re-tries a spent key once before parking it again; the alternative (a shared
 * Mongo document) costs a read on every generate for a saving of one wasted
 * call a day.
 */

const PROVIDERS = ["gemini", "groq", "openrouter", "mistral", "cerebras"] as const;

export type ProviderName = (typeof PROVIDERS)[number];

type ChatMessage = { content: string; role: "system" | "user" };

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

export type LLMOptions = {
  json?: boolean;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
};

export class LLMExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMExhaustedError";
  }
}

/** Env var holding a provider's comma-separated key list. */
const KEY_ENV: Record<ProviderName, string> = {
  cerebras: "CEREBRAS_API_KEYS",
  gemini: "GEMINI_API_KEYS",
  groq: "GROQ_API_KEYS",
  mistral: "MISTRAL_API_KEYS",
  openrouter: "OPENROUTER_API_KEYS",
};

const MODELS: Record<ProviderName, string> = {
  cerebras: "llama3.1-8b",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.1-8b-instant",
  mistral: "mistral-small-latest",
  openrouter: "mistralai/mistral-7b-instruct:free",
};

/** OpenAI-compatible chat-completions endpoints. Gemini is handled separately. */
const CHAT_ENDPOINTS: Record<Exclude<ProviderName, "gemini">, string> = {
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

/** `provider:index` → time the key is allowed to be tried again. */
const exhaustedUntil = new Map<string, number>();

function nextMidnightUtc(): number {
  const date = new Date();
  date.setUTCHours(24, 0, 0, 0);
  return date.getTime();
}

function keysFor(provider: ProviderName): string[] {
  return (process.env[KEY_ENV[provider]] ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function providerOrder(): ProviderName[] {
  const configured = (process.env.LLM_PROVIDER_ORDER ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is ProviderName =>
      PROVIDERS.includes(name as ProviderName),
    );

  return configured.length > 0 ? configured : [...PROVIDERS];
}

/** True when at least one provider has a key configured. */
export function isLLMConfigured(): boolean {
  return providerOrder().some((provider) => keysFor(provider).length > 0);
}

function isQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("403") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  );
}

function buildMessages(prompt: string, opts: LLMOptions): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (opts.systemPrompt) {
    messages.push({ content: opts.systemPrompt, role: "system" });
  }
  messages.push({
    content: opts.json ? `${prompt}\nRespond ONLY in valid JSON.` : prompt,
    role: "user",
  });
  return messages;
}

async function runGemini(key: string, prompt: string, opts: LLMOptions): Promise<string> {
  const body = {
    contents: [
      {
        parts: [
          {
            text: [
              opts.systemPrompt ? `System Instruction:\n${opts.systemPrompt}` : "",
              `User Request:\n${prompt}`,
              opts.json ? "Respond ONLY in valid JSON." : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`,
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

async function runOpenAICompatible(
  provider: Exclude<ProviderName, "gemini">,
  key: string,
  prompt: string,
  opts: LLMOptions,
): Promise<string> {
  const response = await fetch(CHAT_ENDPOINTS[provider], {
    body: JSON.stringify({
      max_tokens: opts.maxTokens ?? 1024,
      messages: buildMessages(prompt, opts),
      model: MODELS[provider],
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${provider} HTTP ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

async function executeAttempt(prompt: string, opts: LLMOptions): Promise<string> {
  const now = Date.now();
  let sawTransientFailure = false;
  let lastErrorMessage = "";

  for (const provider of providerOrder()) {
    const keys = keysFor(provider);

    for (const [index, key] of keys.entries()) {
      const slot = `${provider}:${index}`;
      const parkedUntil = exhaustedUntil.get(slot);
      if (parkedUntil != null && now < parkedUntil) {
        continue;
      }
      exhaustedUntil.delete(slot);

      try {
        const result =
          provider === "gemini"
            ? await runGemini(key, prompt, opts)
            : await runOpenAICompatible(provider, key, prompt, opts);

        if (result.trim()) {
          return result;
        }
        // An empty body is not a quota problem — fall through to the next key.
        sawTransientFailure = true;
        lastErrorMessage = `${provider} returned an empty response.`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastErrorMessage = message;
        console.error(`[LLM ${slot}]`, message);

        if (isQuotaError(message)) {
          exhaustedUntil.set(slot, nextMidnightUtc());
        } else {
          sawTransientFailure = true;
        }
      }
    }
  }

  if (sawTransientFailure) {
    throw new Error(lastErrorMessage || "AI providers failed temporarily.");
  }

  throw new LLMExhaustedError(
    "All AI providers and keys are currently exhausted or unconfigured.",
  );
}

/**
 * Generate text, retrying the whole provider sweep once on a transient failure.
 * Returns "" rather than throwing when everything is exhausted — callers are
 * expected to have a non-AI fallback path.
 */
export async function llmGenerate(
  prompt: string,
  opts: LLMOptions = {},
): Promise<string> {
  if (!isLLMConfigured()) {
    return "";
  }

  try {
    return await executeAttempt(prompt, opts);
  } catch (error) {
    if (error instanceof LLMExhaustedError) {
      return "";
    }

    return await executeAttempt(prompt, opts).catch(() => "");
  }
}
