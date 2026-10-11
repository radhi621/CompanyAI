import { ApiError } from "../../utils/apiError";
import { env } from "../../config/env";
import { geminiClient } from "./geminiClient";
import { groqClient } from "./groqClient";
import type { ChatRequest, ChatTurn } from "./chatTypes";

export type LLMProvider = "gemini" | "groq";

export interface LLMResponse {
  provider: LLMProvider;
  text: string;
} 

export interface LLMGenerateOptions {
  retriesPerProvider?: number;
  retryBaseDelayMs?: number;
  providerOrder?: LLMProvider[];
}

// Looked up at call time, so tests can replace a client's methods.
const clients: Record<LLMProvider, typeof geminiClient | typeof groqClient> = {
  gemini: geminiClient,
  groq: groqClient,
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

function extractRetryDelayMs(message: string): number | null {

  // Gemini: parse retryDelay from the RetryInfo detail (e.g. "retryDelay":"14s")
  const retryDelayMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (retryDelayMatch?.[1]) {
    return Math.ceil(parseFloat(retryDelayMatch[1]) * 1000);
  }

  // Groq: parse "try again in XmYs" or "try again in Xs"
  const groqMinutesMatch = message.match(/try again in (\d+)m(\d+(?:\.\d+)?)s/);
  if (groqMinutesMatch) {
    return Math.ceil(parseInt(groqMinutesMatch[1]) * 60 * 1000 + parseFloat(groqMinutesMatch[2]) * 1000);
  }

  const groqSecondsMatch = message.match(/try again in (\d+(?:\.\d+)?)s/);
  if (groqSecondsMatch?.[1]) {
    return Math.ceil(parseFloat(groqSecondsMatch[1]) * 1000);
  }

  return null;
}

function normalizeProviderOrder(providerOrder?: LLMProvider[]): LLMProvider[] {
  if (!providerOrder || providerOrder.length === 0) {
    return ["gemini", "groq"];
  }

  const unique = Array.from(new Set(providerOrder));
  return unique.filter((provider) => provider === "gemini" || provider === "groq");
}

const LONG_RATE_LIMIT_MS = 30_000;

/** Tries each provider in order, retrying each, and reports why all of them failed. */
async function withProviders<T>(
  call: (provider: LLMProvider) => Promise<T>,
  options?: LLMGenerateOptions,
): Promise<{ provider: LLMProvider; value: T }> {
  const retriesPerProvider = Math.max(
    1,
    Math.min(5, options?.retriesPerProvider ?? env.LLM_RETRIES_PER_PROVIDER),
  );
  const retryBaseDelayMs = Math.max(
    50,
    Math.min(5000, options?.retryBaseDelayMs ?? env.LLM_RETRY_BASE_DELAY_MS),
  );
  const providers = normalizeProviderOrder(options?.providerOrder);
  const errors: Array<{ provider: LLMProvider; attempt: number; message: string }> = [];

  for (const provider of providers) {
    for (let attempt = 1; attempt <= retriesPerProvider; attempt += 1) {
      try {
        return { provider, value: await call(provider) };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({
          provider,
          attempt,
          message: errorMsg,
        });

        console.error(`[LLM Router] ${provider} attempt ${attempt}/${retriesPerProvider} failed: ${errorMsg}`);

        // A long wait (a daily quota) will not pass between attempts: try the next provider.
        const retryDelayMs = extractRetryDelayMs(errorMsg);
        if (retryDelayMs !== null && retryDelayMs > LONG_RATE_LIMIT_MS) {
          break;
        }

        if (attempt < retriesPerProvider) {
          const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
          await sleep(delayMs);
        }
      }
    }
  }

  // Each provider's last failure: "rate limited" only describes the request when every
  // provider was rate limited (a provider returning nothing is not a quota problem).
  const lastErrors = providers.flatMap((provider) => {
    const last = errors.filter((entry) => entry.provider === provider).at(-1);
    return last ? [{ provider, delayMs: extractRetryDelayMs(last.message), message: last.message }] : [];
  });
  const allRateLimited = lastErrors.length > 0 && lastErrors.every((entry) => entry.delayMs !== null);
  const maxDelaySec = allRateLimited
    ? Math.ceil(Math.max(...lastErrors.map((entry) => entry.delayMs ?? 0)) / 1000)
    : null;

  const message = maxDelaySec
    ? `All LLM providers are rate limited. Try again in ${maxDelaySec >= 60 ? `${Math.ceil(maxDelaySec / 60)} minute(s)` : `${maxDelaySec} second(s)`}.`
    : `All LLM providers failed (${lastErrors
        .map((entry) => `${entry.provider}: ${entry.delayMs !== null ? "rate limited" : entry.message.slice(0, 120)}`)
        .join("; ")})`;

  throw new ApiError(502, message, {
    errors,
    retryAfterSeconds: maxDelaySec,
  });
}

export const llmRouter = {
  async generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
    const { provider, value } = await withProviders((name) => clients[name].generateText(prompt), options);
    return { provider, text: value };
  },

  /** One turn of a tool-calling conversation, on the first provider that answers. */
  async chat(request: ChatRequest, options?: LLMGenerateOptions): Promise<{ provider: LLMProvider; turn: ChatTurn }> {
    const { provider, value } = await withProviders((name) => clients[name].chat(request), options);
    return { provider, turn: value };
  },
};
