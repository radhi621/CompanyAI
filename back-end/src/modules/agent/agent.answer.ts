// Writing the answer the user reads from the tool results.
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth";
import { llmRouter, type LLMProvider } from "../../services/llm/llmRouter";
import { buildFallbackAnswer } from "./agent.fallbackAnswer";
import { buildSynthesisPrompt } from "./agent.prompts";
import { type ConversationTurn, type ExecutedToolResult, extractErrorMessage } from "./agent.types";

export interface WrittenAnswer {
  text: string;
  /** null when no provider could write it and the answer was built from the data. */
  provider: LLMProvider | null;
}

/**
 * Writes the answer the user reads from the tool results. When every provider fails, the
 * results are rendered as Markdown instead, so the answer always contains the data.
 */
export async function writeAnswer(
  actor: AuthUser,
  prompt: string,
  results: ExecutedToolResult[],
  history?: ConversationTurn[],
): Promise<WrittenAnswer> {
  try {
    const written = await llmRouter.generate(buildSynthesisPrompt(actor, prompt, results, history), {
      retriesPerProvider: 2,
      retryBaseDelayMs: env.LLM_RETRY_BASE_DELAY_MS,
    });
    return { text: written.text, provider: written.provider };
  } catch (error) {
    console.error(`[Agent] Writing the answer failed, showing the data instead: ${extractErrorMessage(error)}`);
    return { text: buildFallbackAnswer(results), provider: null };
  }
}
