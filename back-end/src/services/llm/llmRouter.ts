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
          errors.push({
            provider,
            attempt,
            message: error instanceof Error ? error.message : String(error),
          });

          if (attempt < retriesPerProvider) {
            const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
            await sleep(delayMs);
          }
        }
      }
    }

    throw new ApiError(502, "All LLM providers failed", {
      errors,
    });
  },
};