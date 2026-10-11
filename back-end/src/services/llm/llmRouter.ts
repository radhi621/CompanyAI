import { ApiError } from "../../utils/apiError";
import { env } from "../../config/env";
import { geminiClient } from "./geminiClient";
import { groqClient } from "./groqClient";
import type { GenerateTextOptions } from "./llmOutput";

export type LLMProvider = "gemini" | "groq";

export interface LLMResponse {
  provider: LLMProvider;
  text: string;
} 

export interface LLMGenerateOptions {
  retriesPerProvider?: number;
  retryBaseDelayMs?: number;
  providerOrder?: LLMProvider[];
  /** The prompt asks for a JSON object: providers run in JSON mode. */
  json?: boolean;
}

const providerMap: Record<LLMProvider, (prompt: string, options: GenerateTextOptions) => Promise<string>> = {
  gemini: geminiClient.generateText,
  groq: groqClient.generateText,
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

export const llmRouter = {
  async generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
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
      const generate = providerMap[provider];

      for (let attempt = 1; attempt <= retriesPerProvider; attempt += 1) {
        try {
          const text = await generate(prompt, { json: options?.json });
          return {
            provider,
            text,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            provider,
            attempt,
            message: errorMsg,
          });

          console.error(`[LLM Router] ${provider} attempt ${attempt}/${retriesPerProvider} failed: ${errorMsg}`);

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
  },
};