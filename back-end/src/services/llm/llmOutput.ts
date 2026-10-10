import { ApiError } from "../../utils/apiError";

/** Output token limit for chat answers; thinking tokens of Gemini 2.5 models count toward it. */
export const MAX_OUTPUT_TOKENS = 4096;

/** Thinking cap for Gemini 2.5 models, so thinking cannot use up the whole output limit. */
export const GEMINI_THINKING_BUDGET = 1024;

/**
 * Collapses runs of spaces inside a line. Models sometimes pad Markdown table cells to line
 * columns up; the chat renders tables itself, so the padding is noise. Leading indentation
 * (code blocks, nested lists) is kept.
 */
export function collapseSpacePadding(text: string): string {
  return text.replace(/(\S) {3,}/g, "$1 ");
}

/**
 * Validates a provider's answer. An answer that stopped at the token limit is incomplete
 * (often a table cut off mid-row), so it is rejected and the router tries the next provider.
 */
export function finalizeLlmText(input: {
  provider: "Gemini" | "Groq";
  text: string | null | undefined;
  stoppedAtTokenLimit: boolean;
}): string {
  if (input.stoppedAtTokenLimit) {
    throw new ApiError(502, `${input.provider} answer was cut off at the output token limit`);
  }

  const text = collapseSpacePadding(input.text ?? "").trim();
  if (!text) {
    throw new ApiError(502, `${input.provider} returned an empty response`);
  }

  return text;
}
