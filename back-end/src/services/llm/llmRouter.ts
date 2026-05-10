import { ApiError } from "../../utils/apiError";
import { env } from "../../config/env";
import { geminiClient } from "./geminiClient";
import { groqClient } from "./groqClient";

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

const providerMap: Record<LLMProvider, (prompt: string) => Promise<string>> = {
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
          const text = await generate(prompt);
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

    // Check if any error was a rate limit and extract the wait time
    const rateLimitDelays = errors
      .map((e) => extractRetryDelayMs(e.message))
      .filter((ms): ms is number => ms !== null);

    const maxDelaySec = rateLimitDelays.length > 0 ? Math.ceil(Math.max(...rateLimitDelays) / 1000) : null;

    const message = maxDelaySec
      ? `All LLM providers are rate limited. Try again in ${maxDelaySec >= 60 ? `${Math.ceil(maxDelaySec / 60)} minute(s)` : `${maxDelaySec} second(s)`}.`
      : "All LLM providers failed";

    throw new ApiError(502, message, {
      errors,
      retryAfterSeconds: maxDelaySec,
    });
  },
};